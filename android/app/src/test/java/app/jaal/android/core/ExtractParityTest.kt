package app.jaal.android.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity between the Kotlin port and jaal/shared/extract.js.
 * golden.json is produced by `node android/tools/golden.js` from the JS source of truth.
 */
class ExtractParityTest {

    private fun golden(): JSONArray {
        val stream = javaClass.classLoader!!.getResourceAsStream("golden.json")
            ?: error("golden.json missing; run node android/tools/golden.js")
        return JSONArray(stream.bufferedReader(Charsets.UTF_8).readText())
    }

    @Test
    fun specSampleYieldsExactKeysAndTrigger() {
        val text = "URGENT: Your SBI KYC expired, account will be blocked today. Update at http://sbi-kyc-update.xyz/login " +
            "or call +91 98765 43210. Pay Rs 10 fee to refund.desk@ybl. A/c no 123456789012 IFSC SBIN0001234. Install anydesk."
        val r = Extract.triage(text)
        assertEquals(
            listOf(
                "url:http://sbi-kyc-update.xyz/login", "domain:sbi-kyc-update.xyz", "upi:refund.desk@ybl",
                "phone:+919876543210", "ifsc:SBIN0001234", "bank_account:123456789012", "remote_app:anydesk"
            ),
            r.identifiers.map { it.key }
        )
        assertEquals("trigger", r.level)
    }

    @Test
    fun smallTalkIsIgnored() {
        val r = Extract.triage("hey are we meeting at 5 tomorrow?")
        assertEquals("ignore", r.level)
        assertTrue(r.identifiers.isEmpty())
    }

    @Test
    fun goldenParityWithJs() {
        val g = golden()
        assertTrue("expected several golden cases", g.length() >= 10)
        for (i in 0 until g.length()) {
            val c = g.getJSONObject(i)
            val text = c.getString("text")
            val ctxJ = c.optJSONObject("ctx") ?: JSONObject()
            val ctx = TriageContext(ctxJ.optBoolean("unknownSender", false), ctxJ.optBoolean("onCall", false))
            val r = Extract.triage(text, ctx)
            val label = "case $i: $text"

            assertEquals("$label level", c.getString("level"), r.level)
            assertEquals("$label score", c.getDouble("score"), r.score, 1e-9)
            val trig = c.getJSONArray("triggers")
            assertEquals("$label triggers", (0 until trig.length()).map { trig.getString(it) }, r.triggers.map { it.id })

            val ids = c.getJSONArray("identifiers")
            assertEquals("$label identifier keys", (0 until ids.length()).map { ids.getJSONObject(it).getString("key") }, r.identifiers.map { it.key })
            for (k in 0 until ids.length()) {
                val e = ids.getJSONObject(k)
                val a = r.identifiers[k]
                assertEquals("$label type", e.getString("type"), a.type)
                assertEquals("$label value", e.getString("value"), a.value)
                assertEquals("$label raw", e.getString("raw"), a.raw)
                if (e.has("shortener")) assertEquals("$label shortener", e.getBoolean("shortener"), a.shortener)
                if (e.has("knownPsp")) assertEquals("$label knownPsp", e.getBoolean("knownPsp"), a.knownPsp)
                if (e.has("chain")) assertEquals("$label chain", e.getString("chain"), a.chain)
                assertEquals("$label prefix", e.getString("prefix"), Extract.keyPrefix(a.key))
            }
        }
    }

    @Test
    fun normalisersMatchJs() {
        assertEquals("+919876543210", Extract.normPhone("098765 43210"))
        assertEquals("+919876543210", Extract.normPhone("919876543210"))
        assertEquals("+923001234567", Extract.normPhone("+923001234567"))
        assertEquals(null, Extract.normPhone("12345"))
        assertEquals("sbi-kyc.co.in", Extract.registrable("www.sbi-kyc.co.in"))
        assertEquals("verify-now.xyz", Extract.registrable("a.b.verify-now.xyz"))
        assertEquals("http://a.com/b/c?q=1%202%27&x=%3C%3E%22", Extract.normUrl("http://A.COM:8080/a/../b/./c?q=1 2'&x=<>\"#frag")!!.url)
        assertEquals("http://127.0.0.1", Extract.normUrl("http://0x7f.1/")!!.url)
        assertEquals(null, Extract.normUrl("http://ex.com:abc/"))
        assertEquals("http://xn--x-9fa.com/%C3%BC?%C3%BC", Extract.normUrl("http://éx.com/ü?ü")!!.url)
        assertEquals("ab12cd34", Extract.hashPrefix("ab12cd34ef"))
    }

    @Test
    fun triageIsFast() {
        val text = golden().getJSONObject(0).getString("text")
        repeat(50) { Extract.triage(text) } // warm up
        val t0 = System.nanoTime()
        repeat(200) { Extract.triage(text) }
        val perCallMs = (System.nanoTime() - t0) / 200.0 / 1e6
        assertTrue("triage took $perCallMs ms", perCallMs < 10.0)
    }
}
