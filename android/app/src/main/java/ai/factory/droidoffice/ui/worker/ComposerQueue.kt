package ai.factory.droidoffice.ui.worker

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.factory.droidoffice.core.DroidQueue
import ai.factory.droidoffice.core.Tags
import ai.factory.droidoffice.core.ThreadQueue
import ai.factory.droidoffice.ui.components.tagged
import ai.factory.droidoffice.ui.theme.OfficeIcons
import ai.factory.droidoffice.ui.theme.ThreadPalette

/** Factory's queued messages panel at the top of the composer, steering messages before queued ones. */
@Composable
internal fun ComposerQueue(
    panel: ThreadQueue.Panel,
    connected: Boolean,
    onClear: () -> Unit,
    onAction: ((action: String, item: ThreadQueue.Panel.Item) -> Unit)?,
) {
    Column(Modifier.fillMaxWidth().tagged(Tags.Worker.COMPOSER_QUEUE)) {
        if (panel.steering.isNotEmpty()) QueueGroup("Steering messages", panel.steering, panel.moreSteering, connected, onAction, offset = 0)
        if (panel.queued.isNotEmpty()) QueueGroup("Queued messages", panel.queued, panel.moreQueued, connected, onAction, offset = panel.steering.size)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${panel.total} message${if (panel.total == 1) "" else "s"} queued",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp, color = ThreadPalette.TextTertiary),
                modifier = Modifier.weight(1f),
            )
            Text(
                "Clear all",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, color = if (connected) ThreadPalette.TextSecondary else ThreadPalette.TextTertiary),
                modifier = Modifier.clip(RoundedCornerShape(4.dp))
                    .clickable(enabled = connected, role = Role.Button, onClickLabel = "Clear all pending messages", onClick = onClear)
                    .tagged(Tags.Worker.COMPOSER_QUEUE_CLEAR).padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun QueueGroup(
    title: String,
    items: List<ThreadQueue.Panel.Item>,
    more: Int,
    connected: Boolean,
    onAction: ((action: String, item: ThreadQueue.Panel.Item) -> Unit)?,
    offset: Int,
) {
    Text(
        title,
        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp, color = ThreadPalette.TextTertiary),
        modifier = Modifier.padding(start = 12.dp, top = 10.dp, end = 12.dp, bottom = 2.dp),
    )
    items.forEachIndexed { i, item ->
        val n = offset + i + 1
        Row(
            Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(start = 12.dp, end = 4.dp).tagged(Tags.Worker.composerQueued(n)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                item.text.ifEmpty { "Image attached" },
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, color = if (i == 0) ThreadPalette.Text else ThreadPalette.TextSecondary),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (item.hasImage) Icon(OfficeIcons.Picture, "Image attached", Modifier.padding(start = 6.dp).size(13.dp), tint = ThreadPalette.TextSecondary)
            if (item.more > 0 || item.preview) Text("…", color = ThreadPalette.TextTertiary, modifier = Modifier.padding(start = 4.dp))
            if (onAction != null) {
                if (item.group == DroidQueue.Group.Queued) QueueAction(OfficeIcons.ArrowUp, "Send now", Tags.Worker.composerQueuedSendNow(n), connected) { onAction("promote", item) }
                QueueAction(OfficeIcons.Trash, "Remove from queue", Tags.Worker.composerQueuedRemove(n), connected) { onAction("delete", item) }
                if (!item.preview) QueueAction(OfficeIcons.SquarePen, "Edit message", Tags.Worker.composerQueuedEdit(n), connected) { onAction("edit", item) }
            }
        }
    }
    if (more > 0) Text("+$more more", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp, color = ThreadPalette.TextTertiary), modifier = Modifier.padding(horizontal = 12.dp))
}

@Composable
private fun QueueAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tag: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(32.dp).clip(RoundedCornerShape(4.dp)).clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick).tagged(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, Modifier.size(14.dp), tint = if (enabled) ThreadPalette.TextSecondary else ThreadPalette.TextTertiary)
    }
}
