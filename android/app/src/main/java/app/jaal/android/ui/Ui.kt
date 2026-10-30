package app.jaal.android.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.util.TypedValue
import android.widget.Toast
import app.jaal.android.R
import app.jaal.android.data.Prefs
import app.jaal.android.data.Verdict
import java.util.Locale

/** In-app language (en / hi / gu) without AppCompat: wrap every Context we inflate or read strings from. */
object Lang {
    val SUPPORTED = listOf("en", "hi", "gu")

    fun wrap(base: Context): Context {
        val lang = Prefs(base).lang
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(Locale(lang))
        return base.createConfigurationContext(cfg)
    }
}

/** Base for every screen: applies the chosen language. */
abstract class BaseActivity : Activity() {
    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(Lang.wrap(newBase))
}

fun Context.dp(v: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)
fun Context.dpi(v: Float): Int = dp(v).toInt()

fun Context.toast(msg: CharSequence) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

private fun Context.isActivity(): Boolean {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return true; c = c.baseContext }
    return false
}

fun Context.launch(i: Intent) {
    if (!isActivity()) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try { startActivity(i) } catch (e: Exception) { toast(e.message ?: "No app to open this") }
}

/** Runs a verdict Action (SPEC `Action.id`). Never auto-submits, never auto-calls. */
object Actions {
    const val CHAKSHU_URL = "https://sancharsaathi.gov.in/sfc/"

    fun label(ctx: Context, a: Verdict.Action): String = a.label.ifBlank {
        when (a.id) {
            "chakshu" -> ctx.getString(R.string.action_chakshu)
            "call_1930" -> ctx.getString(R.string.action_call_1930)
            "share_family" -> ctx.getString(R.string.action_share_family)
            "dispute" -> ctx.getString(R.string.action_dispute)
            else -> a.id
        }
    }

    fun draft(v: Verdict, a: Verdict.Action? = null): String = a?.text?.takeIf { it.isNotBlank() } ?: buildString {
        append("Suspected scam contact reported via JAAL.\n")
        v.identifiers.forEach { append("${it.type}: ${it.value}\n") }
        append(v.headline).append(". ").append(v.reason)
    }

    fun run(ctx: Context, v: Verdict, id: String, source: String) {
        val a = v.actions.firstOrNull { it.id == id }
        when (id) {
            "chakshu" -> {
                copy(ctx, draft(v, a))
                ctx.toast(ctx.getString(R.string.draft_copied))
                ctx.launch(Intent(Intent.ACTION_VIEW, Uri.parse(a?.href ?: CHAKSHU_URL)))
            }
            "call_1930" -> ctx.launch(Intent(Intent.ACTION_DIAL, Uri.parse("tel:1930")))
            "share_family" -> {
                val primary = v.primary?.second ?: v.identifiers.firstOrNull()?.value ?: ""
                val text = a?.text ?: ctx.getString(R.string.share_family_text, v.headline, v.reason, primary)
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                ctx.launch(Intent.createChooser(send, ctx.getString(R.string.action_share_family)))
            }
            "bank_email" -> {
                val uri = a?.href?.takeIf { it.startsWith("mailto:") } ?: ("mailto:?body=" + Uri.encode(draft(v, a)))
                ctx.launch(Intent(Intent.ACTION_SENDTO, Uri.parse(uri)))
            }
            else -> ctx.launch(VerdictActivity.intent(ctx, v, source, openDispute = id == "dispute"))
        }
    }

    fun copy(ctx: Context, text: String) {
        ctx.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("JAAL", text))
    }
}
