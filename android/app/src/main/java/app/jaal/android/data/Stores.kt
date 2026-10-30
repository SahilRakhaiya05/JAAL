package app.jaal.android.data

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Local copy of GET /api/prefixes (Safe Browsing pattern): 8-hex prefixes of SHA-256(canonical key) for
 * every reported/confirmed identifier. A 'check'-level item only leaves the phone on a prefix hit.
 */
object PrefixStore {
    private const val TAG = "JaalPrefix"
    const val MAX_AGE_MS = 30 * 60 * 1000L

    @Volatile private var set: Set<String> = emptySet()
    @Volatile private var fetchedAt = 0L
    @Volatile private var loaded = false
    @Volatile var version: String = ""
        private set

    private fun file(ctx: Context) = File(ctx.filesDir, "prefixes.json")

    @Synchronized
    fun load(ctx: Context) {
        if (loaded) return
        loaded = true
        try {
            val f = file(ctx)
            if (!f.exists()) return
            val o = JSONObject(f.readText())
            val a = o.optJSONArray("prefixes") ?: JSONArray()
            set = (0 until a.length()).map { a.optString(it) }.toHashSet()
            fetchedAt = o.optLong("fetchedAt", 0L)
            version = o.optString("version", "")
        } catch (e: Exception) {
            Log.w(TAG, "prefix cache unreadable", e)
        }
    }

    fun isReady(ctx: Context): Boolean { load(ctx); return fetchedAt > 0 }
    fun size(ctx: Context): Int { load(ctx); return set.size }
    fun contains(ctx: Context, prefix: String): Boolean { load(ctx); return set.contains(prefix) }
    fun isStale(ctx: Context): Boolean { load(ctx); return System.currentTimeMillis() - fetchedAt > MAX_AGE_MS }

    suspend fun syncIfStale(ctx: Context, force: Boolean = false): Boolean {
        if (!force && !isStale(ctx)) return true
        return try {
            val (ver, list) = ApiClient(Prefs(ctx).apiBase).prefixes()
            val now = System.currentTimeMillis()
            set = list.toHashSet()
            fetchedAt = now
            version = ver
            file(ctx).writeText(JSONObject().put("version", ver).put("fetchedAt", now).put("prefixes", JSONArray(list)).toString())
            Log.i(TAG, "synced ${list.size} prefixes v=$ver")
            true
        } catch (e: Exception) {
            Log.w(TAG, "prefix sync failed: ${e.message}")
            false
        }
    }
}

/** Recent checks shown on Home. Stores verdict JSON (identifiers + reason), never the message text. */
object RecentStore {
    private const val MAX = 30

    data class Entry(val at: Long, val state: String, val headline: String, val primary: String, val source: String, val verdictJson: String)

    private fun file(ctx: Context) = File(ctx.filesDir, "recent.json")

    @Synchronized
    fun add(ctx: Context, v: Verdict, source: String) {
        val list = all(ctx).toMutableList()
        val primary = v.primary?.let { "${it.first}:${it.second}" } ?: v.identifiers.firstOrNull()?.let { "${it.type}:${it.value}" } ?: ""
        list.add(0, Entry(System.currentTimeMillis(), v.state, v.headline, primary, source, v.raw))
        val a = JSONArray()
        list.take(MAX).forEach {
            a.put(JSONObject().put("at", it.at).put("state", it.state).put("headline", it.headline).put("primary", it.primary)
                .put("source", it.source).put("verdict", it.verdictJson))
        }
        file(ctx).writeText(a.toString())
    }

    @Synchronized
    fun all(ctx: Context): List<Entry> = try {
        val f = file(ctx)
        if (!f.exists()) emptyList() else JSONArray(f.readText()).objects().map {
            Entry(it.optLong("at"), it.optString("state"), it.optString("headline"), it.optString("primary"), it.optString("source"), it.optString("verdict"))
        }
    } catch (e: Exception) {
        emptyList()
    }
}
