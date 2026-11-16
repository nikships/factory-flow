package ai.factory.droidoffice.ui.worker

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.factory.droidoffice.core.Tags
import ai.factory.droidoffice.core.ThreadActions
import ai.factory.droidoffice.core.ThreadTurns
import ai.factory.droidoffice.ui.components.tagged
import ai.factory.droidoffice.ui.theme.ThreadPalette

/**
 * Factory's rewind confirmation with the TUI's file-restoration choices: keep every file, restore them
 * all, or pick which of [files] (the ones changed since the message) to restore.
 */
@Composable
internal fun ThreadRewindDialog(
    text: String,
    busy: Boolean,
    error: String?,
    files: List<ThreadTurns.RewindFile> = emptyList(),
    onChoose: (restore: String, files: List<String>) -> Unit,
    onCancel: () -> Unit,
) {
    val paths = files.map { it.path }
    var picked by remember { mutableStateOf("conversation") }
    // Without files to choose from, "choose" falls back to keeping every file.
    val restore = if (picked == "choose" && files.isEmpty()) "conversation" else picked
    val wanted = remember(paths) { mutableStateListOf<String>().apply { addAll(paths) } }
    AlertDialog(
        onDismissRequest = { if (!busy) onCancel() },
        containerColor = ThreadPalette.Surface,
        titleContentColor = ThreadPalette.Text,
        textContentColor = ThreadPalette.TextSecondary,
        title = { Text("Rewind Conversation") },
        text = {
            Column(Modifier.fillMaxWidth().tagged(Tags.Worker.THREAD_REWIND)) {
                Text("Are you sure you want to rewind to this message?", style = MaterialTheme.typography.bodyMedium)
                Text(
                    ThreadActions.preview(text),
                    style = MaterialTheme.typography.bodySmall.copy(color = ThreadPalette.TextTertiary),
                    modifier = Modifier.padding(top = 10.dp, bottom = 16.dp),
                )
                RestoreChoice(
                    selected = restore == "conversation",
                    title = "Don't restore files",
                    description = "Rewind conversation only, keep files as they are",
                    tag = Tags.Worker.THREAD_REWIND_KEEP,
                    enabled = !busy,
                ) { picked = "conversation" }
                RestoreChoice(
                    selected = restore == "files",
                    title = "Restore all files",
                    description = "Restore changed files and delete files created after this message",
                    tag = Tags.Worker.THREAD_REWIND_RESTORE,
                    enabled = !busy,
                ) { picked = "files" }
                if (files.isNotEmpty()) RestoreChoice(
                    selected = restore == "choose",
                    title = "Choose files to restore...",
                    description = "Pick which of the ${if (files.size == 1) "file" else "${files.size} files"} changed since this message to restore",
                    tag = Tags.Worker.THREAD_REWIND_CHOOSE,
                    enabled = !busy,
                ) { picked = "choose" }
                if (restore == "choose") Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState()).padding(start = 24.dp)) {
                    for (file in files) {
                        val checked = file.path in wanted
                        Row(
                            Modifier.fillMaxWidth().toggleable(checked, enabled = !busy, role = Role.Checkbox) { if (it) wanted += file.path else wanted -= file.path }
                                .tagged(Tags.Worker.rewindFile(file.shortPath)),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = checked, onCheckedChange = null, enabled = !busy)
                            Text(file.shortPath, style = MaterialTheme.typography.bodySmall.copy(color = ThreadPalette.Text), maxLines = 1, modifier = Modifier.weight(1f).padding(start = 6.dp))
                            Text(if (file.delete) "delete" else "restore", style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, color = ThreadPalette.TextTertiary))
                        }
                    }
                }
                if (error != null) {
                    Text(error, style = MaterialTheme.typography.bodySmall.copy(color = ThreadPalette.Danger), modifier = Modifier.padding(top = 12.dp))
                }
            }
        },
        confirmButton = {
            val choosing = restore == "choose"
            val ready = !busy && (!choosing || wanted.isNotEmpty())
            TextButton(onClick = { onChoose(restore, if (choosing) paths.filter { it in wanted } else emptyList()) }, enabled = ready, modifier = Modifier.tagged(Tags.Worker.THREAD_REWIND_CONFIRM)) {
                Text(if (busy) "Rewinding…" else "Rewind", color = if (ready) ThreadPalette.Accent else ThreadPalette.TextTertiary)
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel, enabled = !busy, modifier = Modifier.tagged(Tags.Worker.THREAD_REWIND_CANCEL)) {
                Text("Cancel", color = ThreadPalette.TextSecondary)
            }
        },
    )
}

@Composable
private fun RestoreChoice(selected: Boolean, title: String, description: String, tag: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .tagged(tag).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, enabled = enabled)
        Column(Modifier.padding(start = 8.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium.copy(color = ThreadPalette.Text))
            Text(description, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, color = ThreadPalette.TextSecondary))
        }
    }
}
