package app.jaal.android.service

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import app.jaal.android.ui.CheckActivity

/**
 * Quick Settings tile "Check clipboard". Android 10+ blocks background clipboard reads, so the tile opens
 * a small JAAL window (CheckActivity) which reads the clipboard once it has input focus — the honest version.
 */
class ClipboardTileService : TileService() {

    override fun onStartListening() {
        qsTile?.let { it.state = Tile.STATE_INACTIVE; it.updateTile() }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        val i = Intent(this, CheckActivity::class.java)
            .putExtra(CheckActivity.EXTRA_MODE, CheckActivity.MODE_CLIPBOARD)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val go = {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 7, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(i)
            }
        }
        if (isLocked) unlockAndRun { go() } else go()
    }
}
