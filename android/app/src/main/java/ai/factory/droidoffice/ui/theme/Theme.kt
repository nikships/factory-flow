package ai.factory.droidoffice.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ai.factory.droidoffice.R

// The office's own palette (src/client/style.css :root): near-black ground, hairline borders,
// one orange accent, and status colors that mean the same thing as on the laptop.
object Palette {
    val Bg = Color(0xFF020202)
    val Surface = Color(0xFF0A0A0A)
    val SurfaceRaised = Color(0xFF101010)
    val SurfaceHover = Color(0xFF151515)
    val SurfaceHigh = Color(0xFF1B1B1B)
    val Border = Color(0x17FFFFFF)
    val BorderStrong = Color(0x2EFFFFFF)
    val Text = Color(0xFFEEEEEE)
    val TextSecondary = Color(0xFF8C8C8C)
    val TextTertiary = Color(0x52FFFFFF)
    val Accent = Color(0xFFEE6018)
    val AccentHover = Color(0xFFEF6F2E)
    val AccentPressed = Color(0xFFD15010)
    val AccentMuted = Color(0x24EE6018)
    val Success = Color(0xFF3CCF91)
    val Warning = Color(0xFFF2B84B)
    val Danger = Color(0xFFEF4444)
    val Info = Color(0xFF5AA9E6)
}

// The worker Thread's palette, as the Factory app draws a conversation (src/client/style.css
// .worker-thread): a pure black ground, warm greys, a raised slab for the owner's words, blue
// links and Factory's diff colours. Accent and status colours stay the office's.
object ThreadPalette {
    val Bg = Color(0xFF000000)
    val Surface = Color(0xFF0C0B0A)
    val SurfaceRaised = Color(0xFF100E0D)
    val SurfaceHover = Color(0xFF151311)
    val SurfaceHigh = Color(0xFF1D1A18)
    val Border = Color(0xFF1D1A18)
    val BorderStrong = Color(0xFF2E2926)
    val Text = Color(0xFFFDFCFB)
    val TextSecondary = Color(0xFFB5ADA7)
    val TextTertiary = Color(0xFF80756F)
    val Accent = Palette.Accent
    val AccentHover = Palette.AccentHover
    val AccentMuted = Palette.AccentMuted
    val Success = Palette.Success
    val Warning = Palette.Warning
    val Danger = Palette.Danger
    val Info = Palette.Info
    val UserSlab = Color(0xFF282523)
    val Code = Color(0xFF151311)
    val Link = Color(0xFF50ACF2)
    val InputBorder = Color(0xFF463F3C)
    val Add = Color(0xFF6FAE5D)
    val Del = Color(0xFFF0442E)
    // color-mix(var(--bg) 84%, #4f8f41 / #d72d17 16%) and 78/22 for the gutters, worked out against Bg.
    val AddRow = Color(0xFF121B0F)
    val DelRow = Color(0xFF270B08)
    val AddGutter = Color(0xFF162312)
    val DelGutter = Color(0xFF340E09)
    // Factory's core-v2 dark tokens the transcript shell reads: tool and thought labels, the stronger
    // hairline, and the Stop button's tungsten square-in-square.
    val ToolLabel = Color(0xFFB5ADA7)
    val BorderEmphasis = Color(0xFF564E4A)
    val StopFill = Color(0xFF342F2D)
    val StopFillPressed = Color(0xFF403A37)
    val StopMark = Color(0xFFD8D4D2)
}

@Immutable
data class OfficeType(
    val mono: FontFamily,
    /** Small upper-case mono labels: the office's metadata voice ("WORKING · 12M"). */
    val eyebrow: TextStyle,
    val monoBody: TextStyle,
)

val LocalOfficeType = staticCompositionLocalOf<OfficeType> { error("DroidOfficeTheme missing") }

private fun variable(res: Int, weight: Int) = Font(res, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

val Geist = FontFamily((300..800 step 100).map { variable(R.font.geist, it) })
val GeistMono = FontFamily((400..700 step 100).map { variable(R.font.geist_mono, it) })

private val base = TextStyle(fontFamily = Geist, color = Palette.Text)

private val AppTypography = Typography(
    displayLarge = base.copy(fontSize = 52.sp, lineHeight = 54.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.035).em),
    displayMedium = base.copy(fontSize = 40.sp, lineHeight = 44.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.03).em),
    displaySmall = base.copy(fontSize = 32.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.025).em),
    headlineLarge = base.copy(fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.02).em),
    headlineMedium = base.copy(fontSize = 24.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.02).em),
    headlineSmall = base.copy(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.015).em),
    titleLarge = base.copy(fontSize = 19.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em),
    titleMedium = base.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = base.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = base.copy(fontSize = 12.5.sp, lineHeight = 18.sp, color = Palette.TextSecondary),
    labelLarge = base.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    labelMedium = base.copy(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = base.copy(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(14.dp),
    extraLarge = RoundedCornerShape(22.dp),
)

private val Scheme = darkColorScheme(
    primary = Palette.Accent,
    onPrimary = Palette.Bg,
    primaryContainer = Color(0xFF2A140A),
    onPrimaryContainer = Color(0xFFFFB896),
    secondary = Palette.Text,
    onSecondary = Palette.Bg,
    secondaryContainer = Palette.SurfaceHover,
    onSecondaryContainer = Palette.Text,
    tertiary = Palette.Success,
    onTertiary = Palette.Bg,
    background = Palette.Bg,
    onBackground = Palette.Text,
    surface = Palette.Bg,
    onSurface = Palette.Text,
    surfaceVariant = Palette.SurfaceRaised,
    onSurfaceVariant = Palette.TextSecondary,
    surfaceContainerLowest = Palette.Bg,
    surfaceContainerLow = Palette.Surface,
    surfaceContainer = Palette.SurfaceRaised,
    surfaceContainerHigh = Palette.SurfaceHover,
    surfaceContainerHighest = Palette.SurfaceHigh,
    surfaceBright = Palette.SurfaceHigh,
    surfaceDim = Palette.Bg,
    inverseSurface = Palette.Text,
    inverseOnSurface = Palette.Bg,
    outline = Color(0xFF2E2E2E),
    outlineVariant = Color(0xFF181818),
    error = Palette.Danger,
    onError = Palette.Bg,
    errorContainer = Color(0xFF2A0D0D),
    onErrorContainer = Color(0xFFFFB4B4),
    scrim = Color(0xCC000000),
)

@Composable
fun DroidOfficeTheme(content: @Composable () -> Unit) {
    val type = remember {
        OfficeType(
            mono = GeistMono,
            eyebrow = TextStyle(fontFamily = GeistMono, fontSize = 10.5.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.08.em, color = Palette.TextSecondary),
            monoBody = TextStyle(fontFamily = GeistMono, fontSize = 13.sp, lineHeight = 19.sp, color = Palette.Text),
        )
    }
    MaterialTheme(colorScheme = Scheme, typography = AppTypography, shapes = AppShapes) {
        CompositionLocalProvider(LocalOfficeType provides type, LocalContentColor provides Palette.Text, content = content)
    }
}
