package app.jaal.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Thin HttpURLConnection client for the JAAL API (SPEC.md "HTTP API"). No third-party HTTP stack. */
class ApiClient(baseUrl: String) {
    private val base = baseUrl.trimEnd('/')

    class ApiException(msg: String) : IOException(msg)

    suspend fun check(body: JSONObject): Verdict = Verdict.from(JSONObject(post("/api/check", body)))

    suspend fun prefixes(): Pair<String, List<String>> {
        val o = JSONObject(get("/api/prefixes"))
        val a = o.optJSONArray("prefixes") ?: JSONArray()
        return o.optString("version", "") to (0 until a.length()).map { a.optString(it) }
    }

    suspend fun health(): JSONObject = JSONObject(get("/api/health"))

    suspend fun dispute(type: String, value: String, reason: String): JSONObject =
        JSONObject(post("/api/dispute", JSONObject().put("type", type).put("value", value).put("reason", reason)))

    suspend fun guardianPair(deviceHash: String): String =
        JSONObject(post("/api/guardian/pair", JSONObject().put("deviceHash", deviceHash))).getString("code")

    suspend fun guardianLink(code: String, guardianHash: String): Boolean =
        JSONObject(post("/api/guardian/link", JSONObject().put("code", code).put("guardianHash", guardianHash))).optBoolean("ok", false)

    suspend fun guardianAlert(deviceHash: String, verdictId: String) {
        post("/api/guardian/alert", JSONObject().put("deviceHash", deviceHash).put("verdictId", verdictId))
    }

    /** [{ verdict, at }] */
    suspend fun guardianAlerts(guardianHash: String): JSONArray =
        JSONArray(get("/api/guardian/alerts?guardianHash=" + URLEncoder.encode(guardianHash, "UTF-8")))

    private suspend fun get(path: String): String = request("GET", path, null)
    private suspend fun post(path: String, body: JSONObject): String = request("POST", path, body.toString())

    private suspend fun request(method: String, path: String, body: String?): String = withContext(Dispatchers.IO) {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 5000
            c.readTimeout = 8000
            c.setRequestProperty("Accept", "application/json")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) throw ApiException("HTTP $code $path")
            text
        } finally {
            c.disconnect()
        }
    }
}
