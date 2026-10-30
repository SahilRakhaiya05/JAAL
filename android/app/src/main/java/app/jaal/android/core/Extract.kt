package app.jaal.android.core

import java.net.IDN
import java.security.MessageDigest
import java.text.Normalizer
import java.util.regex.Matcher
import java.util.regex.Pattern
import kotlin.math.exp

/**
 * Faithful Kotlin port of jaal/shared/extract.js (identifier extraction + on-device triage).
 *
 * Phone and server MUST agree on canonical keys, so every regex below is the JS regex rewritten to
 * be engine-independent: Android's java.util.regex is ICU-backed (Unicode \w \d \b \s) while the
 * JVM used for unit tests is ASCII-by-default, and JS is a third flavour. We therefore never use
 * \w \d \b \s or `.` directly:
 *   JS \d  -> [0-9]                    JS \w -> [A-Za-z0-9_]
 *   JS \s  -> explicit ECMAScript whitespace set (WS)
 *   JS \b  -> (?<!word) before a word char / (?!word) after one (every \b in extract.js sits
 *            next to a word character, so this is exact)
 *   JS .   -> [^\n\r  ]
 * Weights, thresholds, list contents and output order are identical. Parity is enforced by
 * app/src/test (golden outputs produced by node from shared/extract.js; see tools/golden.js).
 */
object Extract {

    val TYPES = listOf("phone", "upi", "bank_account", "ifsc", "url", "domain", "apk", "crypto", "remote_app")

    val UPI_PSPS = listOf(
        "ybl", "ibl", "axl", "okaxis", "okhdfcbank", "okicici", "oksbi", "paytm", "ptyes", "ptaxis", "pthdfc", "ptsbi",
        "upi", "apl", "yapl", "rapl", "axisbank", "icici", "hdfcbank", "sbi", "kotak", "indus", "federal", "idfcbank",
        "jupiteraxis", "fam", "freecharge", "airtel", "jio", "waaxis", "wahdfcbank", "wasbi", "waicici", "pingpay",
        "yesbank", "barodampay", "pnb", "cnrb", "boi", "unionbank", "ikwik", "timecosmos", "abfspay", "superyes", "naviaxis"
    )

    val SHORTENERS = listOf(
        "bit.ly", "tinyurl.com", "cutt.ly", "t.ly", "rb.gy", "is.gd", "shorturl.at", "tiny.cc", "ow.ly",
        "rebrand.ly", "shrtco.de", "goo.gl", "surl.li", "wa.link", "wa.me"
    )

    val REMOTE_APPS = listOf(
        "anydesk", "teamviewer", "quicksupport", "airdroid", "rustdesk", "ultraviewer", "supremo", "alpemix", "splashtop", "remotepc"
    )

    private const val TLDS =
        "com|in|net|org|xyz|top|info|co|io|app|link|live|site|online|shop|club|vip|cc|me|ly|gl|ws|biz|icu|buzz|cyou|sbs|click|world|today|store|tech|pro|work|life|fun|space|website|cloud|support|help|bond|win|loan|money|finance|bank|gov\\.in|co\\.in|org\\.in|net\\.in"

    // ---- JS-compatible building blocks (used inside regex source) ----
    /** ECMAScript \s, for use INSIDE a character class. */
    private const val WS = "\\t\\n\\u000B\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
    /** ECMAScript \w, for use INSIDE a character class. */
    private const val WC = "A-Za-z0-9_"
    /** \b immediately before a word character. */
    private const val B = "(?<![A-Za-z0-9_])"
    /** \b immediately after a word character. */
    private const val E = "(?![A-Za-z0-9_])"
    /** ECMAScript `.` (no dotAll). */
    private const val DOT = "[^\\n\\r\\u2028\\u2029]"
    private const val S = "[$WS]"

    private const val CI = Pattern.CASE_INSENSITIVE

    private fun re(src: String, flags: Int = 0): Pattern = Pattern.compile(src, flags)

    // ---------- regexes (built once) ----------
    private val RE_URL = re("${B}https?://[^$WS<>\"'`)\\]]+", CI)
    private val RE_BARE_DOMAIN = re("$B((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:$TLDS))(?![a-z0-9-])(/[^$WS<>\"'`)\\]]*)?", CI)
    private val RE_PHONE_IN = re("(?:^|[^0-9+])((?:\\+?91[$WS-]?|0)?[6-9][0-9]{4}[$WS-]?[0-9]{5})(?![0-9])")
    private val RE_PHONE_INTL = re("(?:^|[^0-9])(\\+(?!91)[1-9][0-9]{7,14})(?![0-9])")
    private val RE_UPI = re("(?:^|[^$WC.@-])([a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,30})(?![$WC.@-]*\\.[a-z])", CI)
    private val RE_IFSC = re("$B([A-Z]{4}0[A-Z0-9]{6})$E")
    private val RE_BANK_ACCOUNT = re(
        "(?:a/c|acc(?:ount)?|khata|खाता)\\.?$S*(?:no|number|num|sankhya)?\\.?$S*[:.#-]?$S*((?:[0-9][$WS-]?){9,18})(?![0-9])", CI
    )
    private val RE_APK = re("(?:^|[$WS/\"'(])([$WC.()\\-]{1,120}\\.apk)$E", CI)
    private val RE_BTC_BECH32 = re("$B(bc1[ac-hj-np-z02-9]{11,71})$E")
    private val RE_BTC_LEGACY = re("$B([13][a-km-zA-HJ-NP-Z1-9]{25,34})$E")
    private val RE_ETH = re("$B(0x[a-fA-F0-9]{40})$E")
    private val RE_TRX = re("$B(T[1-9A-HJ-NP-Za-km-z]{33})$E")
    private val RE_XMR = re("$B([48][0-9AB][1-9A-HJ-NP-Za-km-z]{93})$E")
    private val RE_CRYPTO_CTX = re("btc|bitcoin|wallet|crypto|usdt|deposit")
    private val RE_ALL_DIGITS_DOTTED = re("^[0-9]+(\\.[0-9]+)+$")
    private val RE_REG_SUFFIX = re("^(co|gov|org|net|ac|edu|nic|res|firm|gen|ind)\\.in$")

    // ---------- normalisers ----------
    fun normPhone(raw: String): String? {
        var d = raw.replace(Regex("[^0-9+]"), "")
        if (d.startsWith("+")) {
            if (d.startsWith("+91") && d.length == 13) return "+91" + d.substring(3)
            return d
        }
        d = d.replace(Regex("^0+"), "")
        if (d.length == 12 && d.startsWith("91")) d = d.substring(2)
        if (d.length == 10) return "+91$d"
        return null
    }

    data class NormUrl(val url: String, val host: String)

    fun normUrl(raw: String): NormUrl? {
        var s = jsTrim(raw).replace(Regex("[.,;:!?]+$"), "")
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s)) s = "http://$s"
        val u = WhatwgUrl.parse(s) ?: return null
        val host = u.hostname.lowercase().replace(Regex("^www\\."), "")
        val path = if (u.pathname == "/") "" else u.pathname.replace(Regex("/+$"), "")
        return NormUrl(u.protocol + "//" + host + path + u.search, host)
    }

    /** Registrable-ish domain: last two labels, or last three for *.co.in / *.gov.in style. */
    fun registrable(host: String): String {
        val parts = host.split(".")
        if (parts.size <= 2) return host
        val last2 = parts.takeLast(2).joinToString(".")
        if (RE_REG_SUFFIX.matcher(last2).find()) return parts.takeLast(3).joinToString(".")
        return last2
    }

    fun canonicalKey(type: String, value: String): String = "$type:$value"

    fun hashPrefix(hexDigest: String): String = hexDigest.take(8)

    fun sha256Hex(s: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(64)
        for (b in d) sb.append(String.format("%02x", b.toInt() and 0xff))
        return sb.toString()
    }

    /** First 8 hex of SHA-256(canonical key) — what /api/prefixes publishes. */
    fun keyPrefix(key: String): String = hashPrefix(sha256Hex(key))

    private class Out {
        val list = ArrayList<Identifier>()
        val seen = HashSet<String>()
        fun push(type: String, value: String?, raw: String, shortener: Boolean? = null, knownPsp: Boolean? = null, chain: String? = null) {
            if (value.isNullOrEmpty()) return
            val key = canonicalKey(type, value)
            if (!seen.add(key)) return
            list.add(Identifier(type, value, raw, key, shortener, knownPsp, chain))
        }
    }

    private fun Matcher.g(i: Int = 0): String = group(i) ?: ""

    private inline fun each(p: Pattern, text: String, fn: (Matcher) -> Unit) {
        val m = p.matcher(text)
        while (m.find()) fn(m)
    }

    /**
     * Pull every scammer-side identifier out of a blob of text.
     * Never returns emails or personal names: those are not identifiers we store.
     */
    fun extract(text: String?): List<Identifier> {
        if (text.isNullOrEmpty()) return emptyList()
        val t = Normalizer.normalize(text, Normalizer.Form.NFKC)
        val out = Out()
        val urlSpans = ArrayList<IntArray>()

        each(RE_URL, t) { m ->
            val n = normUrl(m.g()) ?: return@each
            urlSpans.add(intArrayOf(m.start(), m.end()))
            out.push("url", n.url, m.g(), shortener = SHORTENERS.contains(n.host))
            // Raw IP hosts have no registrable domain; keep the URL only.
            if (!RE_ALL_DIGITS_DOTTED.matcher(n.host).find()) out.push("domain", registrable(n.host), n.host)
        }

        each(RE_BARE_DOMAIN, t) { m ->
            val idx = m.start()
            for (sp in urlSpans) if (idx >= sp[0] && idx < sp[1]) return@each
            if (idx > 0 && t[idx - 1] == '@') return@each // part of an email or UPI handle
            val n = normUrl(m.g()) ?: return@each
            if (RE_ALL_DIGITS_DOTTED.matcher(n.host).find()) return@each // version numbers, amounts
            out.push("domain", registrable(n.host), n.host)
            val g2 = m.group(2)
            if (!g2.isNullOrEmpty()) out.push("url", n.url, m.g(), shortener = SHORTENERS.contains(n.host))
        }

        each(RE_UPI, t) { m ->
            val v = m.g(1).lowercase()
            val psp = v.split("@")[1]
            out.push("upi", v, m.g(1), knownPsp = UPI_PSPS.contains(psp))
        }

        each(RE_PHONE_IN, t) { m -> out.push("phone", normPhone(m.g(1)), m.g(1)) }
        each(RE_PHONE_INTL, t) { m -> out.push("phone", normPhone(m.g(1)), m.g(1)) }

        each(RE_IFSC, t) { m -> out.push("ifsc", m.g(1).uppercase(), m.g(1)) }
        each(RE_BANK_ACCOUNT, t) { m ->
            val digits = m.g(1).replace(Regex("[^0-9]"), "")
            if (digits.length in 9..18) out.push("bank_account", digits, m.g(1))
        }

        each(RE_APK, t) { m -> out.push("apk", m.g(1).lowercase(), m.g(1)) }

        each(RE_BTC_BECH32, t) { m -> out.push("crypto", m.g(1).lowercase(), m.g(1), chain = "btc") }
        each(RE_ETH, t) { m -> out.push("crypto", m.g(1).lowercase(), m.g(1), chain = "eth") }
        each(RE_XMR, t) { m -> out.push("crypto", m.g(1), m.g(1), chain = "xmr") }
        each(RE_TRX, t) { m -> out.push("crypto", m.g(1), m.g(1), chain = "trx") }
        each(RE_BTC_LEGACY, t) { m ->
            // Legacy BTC collides with random base58-ish tokens; require a crypto word nearby.
            val from = maxOf(0, m.start() - 60)
            val to = minOf(t.length, m.start() + m.g().length + 60)
            val ctx = t.substring(from, to).lowercase()
            if (RE_CRYPTO_CTX.matcher(ctx).find()) out.push("crypto", m.g(1), m.g(1), chain = "btc")
        }

        val lower = t.lowercase()
        for (app in REMOTE_APPS) if (lower.contains(app)) out.push("remote_app", app, app)

        // Phone numbers are a subset of bank-account-looking digit runs; drop accounts
        // whose digits are exactly a phone we already captured.
        val phones = out.list.filter { it.type == "phone" }.map { it.value.takeLast(10) }.toHashSet()
        return out.list.filter { !(it.type == "bank_account" && phones.contains(it.value.takeLast(10)) && it.value.length == 10) }
    }

    // ---------- on-device triage ----------
    class Signal(val id: String, val w: Double, src: String, val label: String) {
        val re: Pattern = Pattern.compile(src, CI)
    }

    val SIGNALS = listOf(
        Signal("otp", 1.4, "${B}otp$E|one[$WS-]?time password|ओटीपी|ઓટીપી|verification code", "Asks for an OTP"),
        Signal("pin", 1.6, "upi$S*pin|atm$S*pin|enter (your )?pin|पिन डाल|પિન", "Asks for a UPI or ATM PIN"),
        Signal("kyc", 1.1, "${B}e-?kyc$E|kyc (update|pending|expired|verification)|केवाईसी|કેવાયસી", "KYC update pressure"),
        Signal("block", 1.0, "(account|card|sim|number|wallet)$DOT{0,30}(block|suspend|deactivat|band|बंद|freeze)|will be (blocked|suspended|closed)", "Threatens to block an account"),
        Signal("arrest", 1.9, "digital arrest|arrest warrant|${B}cbi$E|${B}ed$E officer|narcotics|customs$DOT{0,20}(parcel|package)|money laundering|गिरफ्तार|सीबीआई|ધરપકડ", "Digital arrest script"),
        Signal("parcel", 0.8, "(fedex|dhl|courier|parcel|package)$DOT{0,40}(seized|held|drugs|illegal|customs)", "Seized parcel story"),
        Signal("refund", 0.8, "refund|cashback|reversal|wrongly (sent|credited)|galti se", "Refund or wrong-transfer story"),
        Signal("prize", 0.9, "lottery|you (have )?won|prize|lucky draw|kbc|jackpot|इनाम|लॉटरी", "Prize or lottery"),
        Signal("job", 0.9, "work from home|part[$WS-]?time (job|work)|earn (rs\\.?|₹|inr)?$S?[0-9]|daily (income|payout)|like (youtube )?videos|prepaid task|telegram task", "Task or part-time job offer"),
        Signal("invest", 1.0, "guaranteed (returns|profit)|double your|[0-9]{2,3}% (returns|profit)|stock tips|ipo allotment|vip group|trading (app|group)", "Investment returns promise"),
        Signal("bill", 0.9, "electricity (bill|connection)$DOT{0,40}(disconnect|cut)|bijli|light bill", "Electricity disconnection threat"),
        Signal("urgent", 0.6, "urgent|immediately|within (24|2|1) ?(hours|hrs|minutes|mins)|today itself|last chance|तुरंत|abhi", "Urgency pressure"),
        Signal("screenshare", 1.5, "screen ?shar|anydesk|teamviewer|quicksupport|rustdesk|airdroid|remote (access|support)", "Asks to share screen or install remote access"),
        Signal("apk", 1.3, "\\.apk$E|install (this|the) app|download (this|the) app", "Pushes an APK install"),
        Signal("pay", 0.7, "pay (rs\\.?|₹|inr)?$S?[0-9]|send (rs\\.?|₹|inr)?$S?[0-9]|processing fee|registration fee|security deposit|transfer (rs\\.?|₹)", "Requests a payment or fee"),
        Signal("shortlink", 0.6, "$B(bit\\.ly|tinyurl\\.com|cutt\\.ly|rb\\.gy|is\\.gd|t\\.ly|shorturl\\.at|surl\\.li)$E", "Shortened link")
    )

    const val BIAS = -2.2

    private fun sigmoid(x: Double) = 1.0 / (1.0 + exp(-x))

    /**
     * Cheap on-device pass. level:
     *   "ignore"  - discard, never leaves the device
     *   "check"   - has identifiers and a weak signal; ask the hash-prefix set
     *   "trigger" - strong signal; run the full graph check
     */
    fun triage(text: String?, context: TriageContext? = null): TriageResult {
        val t = text ?: ""
        val ids = extract(t)
        var z = BIAS
        val triggers = ArrayList<Trigger>()
        for (s in SIGNALS) {
            if (s.re.matcher(t).find()) {
                z += s.w
                triggers.add(Trigger(s.id, s.label))
            }
        }
        val hasPayable = ids.any { it.type == "upi" || it.type == "bank_account" || it.type == "crypto" }
        val hasLink = ids.any { it.type == "url" || it.type == "apk" }
        if (hasPayable) z += 0.8
        if (hasLink) z += 0.5
        if (context?.unknownSender == true) z += 0.6
        if (context?.onCall == true) z += 1.2
        // JS Math.round(x*1000)/1000 (round half up)
        val score = Math.floor(sigmoid(z) * 1000 + 0.5) / 1000.0
        val level = if (score >= 0.6) "trigger" else if (ids.isNotEmpty() && score >= 0.2) "check" else "ignore"
        return TriageResult(score, level, triggers, ids)
    }

    /** String.prototype.trim: strips ECMAScript whitespace + line terminators. */
    private fun jsTrim(s: String): String {
        fun ws(c: Char) = c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' ||
            c == ' ' || c == ' ' || c in ' '..' ' || c == ' ' || c == ' ' ||
            c == ' ' || c == ' ' || c == '　' || c == '﻿'
        var a = 0
        var b = s.length
        while (a < b && ws(s[a])) a++
        while (b > a && ws(s[b - 1])) b--
        return s.substring(a, b)
    }
}

data class Identifier(
    val type: String,
    val value: String,
    val raw: String,
    val key: String,
    val shortener: Boolean? = null,
    val knownPsp: Boolean? = null,
    val chain: String? = null
)

data class Trigger(val id: String, val label: String)

data class TriageContext(val unknownSender: Boolean = false, val onCall: Boolean = false)

data class TriageResult(val score: Double, val level: String, val triggers: List<Trigger>, val identifiers: List<Identifier>)

/**
 * The subset of the WHATWG URL parser that normUrl() observes (protocol, hostname, pathname, search)
 * for http/https inputs, matching Node 22's `new URL()`. Returns null where `new URL()` throws.
 */
internal object WhatwgUrl {
    class Parsed(val protocol: String, val hostname: String, val pathname: String, val search: String)

    private const val FORBIDDEN_HOST = " #%/:<>?@[\\]^|"

    fun parse(input: String): Parsed? {
        // Leading/trailing C0 control or space are stripped; tab/newline removed anywhere.
        var s = input.trim { it <= ' ' }.replace("\t", "").replace("\n", "").replace("\r", "")
        val colon = s.indexOf(':')
        if (colon <= 0) return null
        val scheme = s.substring(0, colon).lowercase()
        if (scheme != "http" && scheme != "https") return null
        s = s.substring(colon + 1)
        // Special scheme: skip any run of slashes / backslashes before the authority.
        var i = 0
        while (i < s.length && (s[i] == '/' || s[i] == '\\')) i++
        s = s.substring(i)
        var authEnd = s.length
        for (k in s.indices) {
            val c = s[k]
            if (c == '/' || c == '\\' || c == '?' || c == '#') { authEnd = k; break }
        }
        var authority = s.substring(0, authEnd)
        var rest = s.substring(authEnd)
        val at = authority.lastIndexOf('@')
        if (at >= 0) authority = authority.substring(at + 1)
        // Port (IPv6 literals never reach here: '[' / ']' are excluded by the extractor regexes).
        var hostPart = authority
        val pc = authority.lastIndexOf(':')
        if (pc >= 0) {
            val port = authority.substring(pc + 1)
            hostPart = authority.substring(0, pc)
            if (port.isNotEmpty()) {
                if (!port.all { it in '0'..'9' }) return null
                if (port.trimStart('0').length > 5 || (port.toLongOrNull() ?: 0L) > 65535L) return null
            }
        }
        if (hostPart.isEmpty()) return null
        val host = parseHost(hostPart) ?: return null

        val hashIdx = rest.indexOf('#')
        if (hashIdx >= 0) rest = rest.substring(0, hashIdx)
        val qIdx = rest.indexOf('?')
        val rawPath = if (qIdx >= 0) rest.substring(0, qIdx) else rest
        val rawQuery = if (qIdx >= 0) rest.substring(qIdx + 1) else null

        val pathname = normalizePath(rawPath.replace('\\', '/'))
        val search = if (rawQuery.isNullOrEmpty()) "" else "?" + encode(rawQuery, QUERY_SET)
        return Parsed("$scheme:", host, pathname, search)
    }

    private fun parseHost(raw: String): String? {
        val decoded = percentDecode(raw)
        val ascii: String = try {
            IDN.toASCII(decoded, IDN.ALLOW_UNASSIGNED).lowercase()
        } catch (e: Exception) {
            return null
        }
        if (ascii.isEmpty()) return null
        for (c in ascii) {
            if (c.code <= 0x1f || c.code == 0x7f || FORBIDDEN_HOST.indexOf(c) >= 0) return null
        }
        if (endsInNumber(ascii)) return parseIpv4(ascii)
        return ascii
    }

    private fun endsInNumber(host: String): Boolean {
        val parts = host.split(".").toMutableList()
        if (parts.last().isEmpty()) {
            if (parts.size == 1) return false
            parts.removeAt(parts.size - 1)
        }
        val last = parts.last()
        if (last.isNotEmpty() && last.all { it in '0'..'9' }) return true
        if ((last.startsWith("0x") || last.startsWith("0X")) && last.substring(2).all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }) return true
        return false
    }

    private fun parseIpv4(host: String): String? {
        val parts = host.split(".").toMutableList()
        if (parts.last().isEmpty() && parts.size > 1) parts.removeAt(parts.size - 1)
        if (parts.size > 4) return null
        val nums = ArrayList<Long>()
        for (p in parts) {
            if (p.isEmpty()) return null
            var radix = 10
            var digits = p
            if (p.length >= 2 && (p.startsWith("0x") || p.startsWith("0X"))) { radix = 16; digits = p.substring(2) }
            else if (p.length >= 2 && p.startsWith("0")) { radix = 8; digits = p.substring(1) }
            val n = if (digits.isEmpty()) 0L else (digits.toBigIntegerOrNull(radix) ?: return null).let {
                if (it.bitLength() > 40) return null else it.toLong()
            }
            nums.add(n)
        }
        for (k in 0 until nums.size - 1) if (nums[k] > 255) return null
        var limit = 1L
        repeat(5 - nums.size) { limit *= 256 }
        if (nums.last() >= limit) return null
        var ipv4 = nums.last()
        for (k in 0 until nums.size - 1) {
            var mul = 1L
            repeat(3 - k) { mul *= 256 }
            ipv4 += nums[k] * mul
        }
        return listOf((ipv4 shr 24) and 255, (ipv4 shr 16) and 255, (ipv4 shr 8) and 255, ipv4 and 255).joinToString(".")
    }

    private fun isSingleDot(seg: String) = seg == "." || seg.equals("%2e", ignoreCase = true)
    private fun isDoubleDot(seg: String): Boolean {
        val l = seg.lowercase()
        return l == ".." || l == ".%2e" || l == "%2e." || l == "%2e%2e"
    }

    private fun normalizePath(raw: String): String {
        if (raw.isEmpty()) return "/"
        val segs = raw.removePrefix("/").split("/")
        val out = ArrayList<String>()
        for ((idx, seg) in segs.withIndex()) {
            val last = idx == segs.size - 1
            when {
                isDoubleDot(seg) -> {
                    if (out.isNotEmpty()) out.removeAt(out.size - 1)
                    if (last) out.add("")
                }
                isSingleDot(seg) -> if (last) out.add("")
                else -> out.add(encode(seg, PATH_SET))
            }
        }
        return "/" + out.joinToString("/")
    }

    private const val PATH_SET = " \"#<>?`{}"
    private const val QUERY_SET = " \"#<>'"

    private fun encode(s: String, set: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            if (cp < 0x20 || cp > 0x7e || set.indexOf(cp.toChar()) >= 0) {
                for (b in String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)) {
                    sb.append('%').append(String.format("%02X", b.toInt() and 0xff))
                }
            } else sb.append(cp.toChar())
            i += n
        }
        return sb.toString()
    }

    private fun percentDecode(s: String): String {
        if (s.indexOf('%') < 0) return s
        val bytes = java.io.ByteArrayOutputStream()
        var i = 0
        val src = s.toByteArray(Charsets.UTF_8)
        while (i < src.size) {
            val b = src[i]
            if (b == '%'.code.toByte() && i + 2 < src.size &&
                hex(src[i + 1]) >= 0 && hex(src[i + 2]) >= 0
            ) {
                bytes.write(hex(src[i + 1]) * 16 + hex(src[i + 2]))
                i += 3
            } else {
                bytes.write(b.toInt())
                i++
            }
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    private fun hex(b: Byte): Int {
        val c = b.toInt().toChar()
        return when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'f' -> c - 'a' + 10
            in 'A'..'F' -> c - 'A' + 10
            else -> -1
        }
    }
}
