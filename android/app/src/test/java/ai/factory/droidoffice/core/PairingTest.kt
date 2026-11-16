package ai.factory.droidoffice.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
    private fun ok(raw: String) = (Pairing.parse(raw) as InviteParse.Ok).invite
    private fun invalid(raw: String) = (Pairing.parse(raw) as InviteParse.Invalid).reason

    @Test
    fun readsThePayloadWithEveryAddressInOrder() {
        val invite = ok(
            "factoryflow://pair?v=1&name=Dev%27s%20MacBook%20%28Pro%29&t=example_pairing_token_1234567890" +
                "&u=http%3A%2F%2F192.168.1.42%3A4700&u=http%3A%2F%2Fmac-mini.example-tailnet.ts.net%3A4700&u=http%3A%2F%2F100.64.12.34%3A4700",
        )
        assertEquals("Dev's MacBook (Pro)", invite.name)
        assertEquals("example_pairing_token_1234567890", invite.lanToken)
        assertEquals(listOf("http://192.168.1.42:4700", "http://mac-mini.example-tailnet.ts.net:4700", "http://100.64.12.34:4700"), invite.bases)
    }

    @Test
    fun readsTheLinkAnOfficeShows() {
        // As GET /api/mobile/pairing returns it: every value encoded, including ’ and ().
        val invite = ok(
            "factoryflow://pair?v=1&name=Dev%E2%80%99s%20MacBook%20Pro%20%282%29&t=example_pairing_token_0987654321" +
                "&u=http%3A%2F%2F192.168.1.42%3A4720&u=http%3A%2F%2Fmac-mini.example-tailnet.ts.net%3A4720&u=http%3A%2F%2F100.64.12.34%3A4720",
        )
        assertEquals("Dev’s MacBook Pro (2)", invite.name)
        assertEquals(listOf(RouteKind.Lan, RouteKind.Tailscale, RouteKind.Tailscale), invite.bases.map(Routes::kindOf))
    }

    @Test
    fun normalizesAndDeduplicatesAddresses() {
        val invite = ok("factoryflow://pair?t=abcdefgh123&u=HTTPS%3A%2F%2FOffice.Example%3A443%2Fsome%2Fpath&u=https%3A%2F%2Foffice.example")
        assertEquals(listOf("https://office.example"), invite.bases)
        // No name: the first address stands in for it.
        assertEquals("office.example", invite.name)
    }

    @Test
    fun keepsAnUnencodedSpaceInTheName() {
        assertEquals("My Mac", ok("factoryflow://pair?v=1&name=My Mac&t=abcdefgh123&u=http%3A%2F%2F10.0.0.2%3A4700").name)
    }

    @Test
    fun readsThePrintedJoinUrl() {
        val invite = ok("http://192.168.1.20:4700/?t=example_pairing_token_1234567890")
        assertEquals(listOf("http://192.168.1.20:4700"), invite.bases)
        assertEquals("example_pairing_token_1234567890", invite.lanToken)
    }

    @Test
    fun findsTheLinkInsideAChatMessage() {
        val invite = ok("Join my office: http://192.168.1.20:4700/?t=abcdefgh123. See you there")
        assertEquals("abcdefgh123", invite.lanToken)
    }

    @Test
    fun refusesWhatIsntAnInvite() {
        assertTrue(invalid("hello there").isNotBlank())
        assertTrue(invalid("factoryflow://open?t=abcdefgh123&u=http%3A%2F%2F10.0.0.2").contains("pairing"))
        assertTrue(invalid("factoryflow://pair?u=http%3A%2F%2F10.0.0.2").contains("token"))
        assertTrue(invalid("factoryflow://pair?t=abcdefgh123").contains("address"))
        assertTrue(invalid("factoryflow://pair?t=abcdefgh123&u=ftp%3A%2F%2F10.0.0.2").contains("address"))
        assertTrue(invalid("http://192.168.1.20:4700/").contains("token"))
        assertTrue(invalid("factoryflow://pair?v=2&t=abcdefgh123&u=http%3A%2F%2F10.0.0.2").contains("newer"))
    }

    @Test
    fun factoryFlowOwnsItsSchemeWithoutClaimingDroidOfficeLinks() {
        assertEquals("factoryflow", Pairing.SCHEME)
        assertTrue(Pairing.parse("droidoffice://pair?t=abcdefgh123&u=http%3A%2F%2F10.0.0.2%3A4600") is InviteParse.Invalid)
    }

    @Test
    fun refusesATokenWithStrayCharacters() {
        assertTrue(Pairing.parse("factoryflow://pair?t=abc%20def%3Cghi&u=http%3A%2F%2F10.0.0.2") is InviteParse.Invalid)
    }
}
