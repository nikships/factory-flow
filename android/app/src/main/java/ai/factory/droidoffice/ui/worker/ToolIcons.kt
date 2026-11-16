package ai.factory.droidoffice.ui.worker

import ai.factory.droidoffice.core.ToolCards
import ai.factory.droidoffice.ui.theme.OfficeIcons
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The tool icons the app's transcript draws beside each row (Lucide shapes on the 24 grid), stroked
 * like [OfficeIcons] so they sit with its set.
 */
internal object ToolIcons {
    private fun icon(name: String, vararg strokes: String): ImageVector {
        val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (d in strokes) {
            b.addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    private const val SHEET = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"
    private const val FOLD = "M14 2v4a2 2 0 0 0 2 2h4"

    val BookOpen = icon("BookOpen", "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z")
    val FileSearch = icon("FileSearch", FOLD, "M4 7V4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H9", "M2 15a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M7.5 17.5L9 19")
    val ListTree = icon("ListTree", "M21 12h-8", "M21 6H8", "M21 18h-8", "M3 6v4c0 1.1.9 2 2 2h3", "M3 10v6c0 1.1.9 2 2 2h3")
    val Edit3 = icon("Edit3", "M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z")
    val FilePlus = icon("FilePlus", SHEET, FOLD, "M9 15h6", "M12 18v-6")
    val FileDiff = icon("FileDiff", SHEET, "M9 10h6", "M12 13V7", "M9 17h6")
    val FileText = icon("FileText", SHEET, FOLD, "M10 9H8", "M16 13H8", "M16 17H8")
    val HelpCircle = icon("HelpCircle", "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
    val ListTodo = icon("List", "M3 12h.01", "M3 18h.01", "M3 6h.01", "M8 12h13", "M8 18h13", "M8 6h13")
    val Bot = icon("Bot", "M12 8V4H8", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2")
    val Wrench = icon("Wrench", "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z")
    val ImageFile = icon("Image", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21")
    val ArrowRight = icon("ArrowRight", "M5 12h14", "M12 5l7 7-7 7")
    val ChevronsUpDown = icon("ChevronsUpDown", "M7 15l5 5 5-5", "M7 9l5-5 5 5")
    val ChevronsDownUp = icon("ChevronsDownUp", "M7 20l5-5 5 5", "M7 4l5 5 5-5")
    val Maximize = icon("Maximize", "M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7")
    val Info = icon("Info", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01")
    val TriangleAlert = icon("TriangleAlert", "M10.3 3.7L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01")
    val CircleAlert = icon("CircleAlert", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 8v4", "M12 16h.01")
    val MoreHorizontal = icon("MoreHorizontal", "M5 12h.01", "M12 12h.01", "M19 12h.01")

    fun of(glyph: ToolCards.Glyph): ImageVector = when (glyph) {
        ToolCards.Glyph.Read -> BookOpen
        ToolCards.Glyph.Search -> OfficeIcons.Search
        ToolCards.Glyph.Glob -> FileSearch
        ToolCards.Glyph.List -> ListTree
        ToolCards.Glyph.Globe -> OfficeIcons.Globe
        ToolCards.Glyph.Link -> OfficeIcons.Link
        ToolCards.Glyph.Terminal -> OfficeIcons.Terminal
        ToolCards.Glyph.Edit -> Edit3
        ToolCards.Glyph.Create -> FilePlus
        ToolCards.Glyph.Delete -> OfficeIcons.Trash
        ToolCards.Glyph.Patch -> FileDiff
        ToolCards.Glyph.Help -> HelpCircle
        ToolCards.Glyph.Plan -> ListTodo
        ToolCards.Glyph.Bot -> Bot
        ToolCards.Glyph.Wrench -> Wrench
        ToolCards.Glyph.Spec -> FileText
        ToolCards.Glyph.Image -> ImageFile
        ToolCards.Glyph.File -> OfficeIcons.File
    }
}
