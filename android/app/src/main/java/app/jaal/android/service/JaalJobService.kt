package app.jaal.android.service

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import app.jaal.android.data.PrefixStore
import app.jaal.android.guardian.Guardian
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Periodic background job (platform JobScheduler, no WorkManager dependency): prefix-set sync (30-min staleness)
 * and guardian alert polling. Android's minimum period is 15 minutes and Doze can defer it; the guardian also
 * polls every 60 s while JAAL is open and on notification-listener wakeups.
 */
class JaalJobService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartJob(params: JobParameters): Boolean {
        scope.launch {
            PrefixStore.syncIfStale(applicationContext)
            Guardian.poll(applicationContext)
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val JOB_ID = 8787

        fun schedule(ctx: Context) {
            val js = ctx.getSystemService(JobScheduler::class.java) ?: return
            if (js.getPendingJob(JOB_ID) != null) return
            val job = JobInfo.Builder(JOB_ID, ComponentName(ctx, JaalJobService::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .build()
            try { js.schedule(job) } catch (e: Exception) { android.util.Log.w("JaalJob", "schedule failed: ${e.message}") }
        }
    }
}
