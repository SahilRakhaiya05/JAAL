package app.jaal.android.data

import org.json.JSONArray
import org.json.JSONObject

/** Mirrors SPEC.md `Verdict`. The raw JSON is kept so the detail screen can be reopened from history. */
data class Verdict(
    val id: String,
    val state: String,
    val confidence: Double,
    val headline: String,
    val reason: String,
    val identifiers: List<CheckedId>,
    val primary: Pair<String, String>?,
    val stats: Stats,
    val campaign: Campaign?,
    val ring: Ring?,
    val signals: List<Pair<String, String>>,
    val actions: List<Action>,
    val latencyMs: Long,
    val engine: String,
    val raw: String
) {
    data class CheckedId(val type: String, val value: String, val state: String, val reports: Int)
    data class Stats(val reports: Int, val hopsToConfirmed: Int?, val confirmedWithin2Hops: Int, val firstSeen: String?, val lastSeen: String?)
    data class Campaign(val id: String, val name: String, val size: Int, val firstSeen: String, val pattern: String, val cities: List<String>)
    data class Action(val id: String, val label: String, val href: String?, val text: String?)

    val isClear get() = state == STATE_CLEAR
    val isConfirmed get() = state == STATE_CONFIRMED

    companion object {
        const val STATE_CLEAR = "clear"
        const val STATE_REPORTED = "reported"
        const val STATE_CONFIRMED = "confirmed"

        fun parse(json: String): Verdict = from(JSONObject(json))

        fun from(o: JSONObject): Verdict {
            val ids = o.optJSONArray("identifiers").objects().map {
                CheckedId(it.optString("type"), it.optString("value"), it.optString("state", STATE_CLEAR), it.optInt("reports", 0))
            }
            val primary = o.optJSONObject("primary")?.let { it.optString("type") to it.optString("value") }
            val s = o.optJSONObject("stats") ?: JSONObject()
            val stats = Stats(
                s.optInt("reports", 0),
                if (s.isNull("hopsToConfirmed") || !s.has("hopsToConfirmed")) null else s.optInt("hopsToConfirmed"),
                s.optInt("confirmedWithin2Hops", 0),
                s.optStringOrNull("firstSeen"), s.optStringOrNull("lastSeen")
            )
            val campaign = o.optJSONObject("campaign")?.let { c ->
                Campaign(
                    c.optString("id"), c.optString("name"), c.optInt("size", 0), c.optString("firstSeen"), c.optString("pattern"),
                    c.optJSONArray("cities")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
                )
            }
            val signals = o.optJSONArray("signals").objects().map { it.optString("id") to it.optString("label") }
            val actions = o.optJSONArray("actions").objects().map {
                Action(it.optString("id"), it.optString("label"), it.optStringOrNull("href"), it.optStringOrNull("text"))
            }
            return Verdict(
                id = o.optString("id"),
                state = o.optString("state", STATE_CLEAR),
                confidence = o.optDouble("confidence", 0.0),
                headline = o.optString("headline"),
                reason = o.optString("reason"),
                identifiers = ids,
                primary = primary,
                stats = stats,
                campaign = campaign,
                ring = o.optJSONObject("ring")?.let { Ring.from(it) },
                signals = signals,
                actions = actions,
                latencyMs = o.optLong("latencyMs", 0L),
                engine = o.optString("engine", "memory"),
                raw = o.toString()
            )
        }
    }
}

data class Ring(val center: String, val nodes: List<Node>, val edges: List<Edge>) {
    data class Node(val id: String, val type: String, val label: String, val hop: Int, val reports: Int, val confirmed: Boolean)
    data class Edge(val source: String, val target: String, val type: String)

    companion object {
        fun from(o: JSONObject) = Ring(
            o.optString("center"),
            o.optJSONArray("nodes").objects().map {
                Node(it.optString("id"), it.optString("type"), it.optString("label"), it.optInt("hop", 0), it.optInt("reports", 0), it.optBoolean("confirmed", false))
            },
            o.optJSONArray("edges").objects().map { Edge(it.optString("source"), it.optString("target"), it.optString("type")) }
        )
    }
}

internal fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    val out = ArrayList<JSONObject>(length())
    for (i in 0 until length()) optJSONObject(i)?.let { out.add(it) }
    return out
}

internal fun JSONObject.optStringOrNull(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
