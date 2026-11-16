# Client

- Vite ships `dashboard.html` as the companion at `/dashboard`; the server redirects `/` there. Static files live in `public/`.
- DOM panels live in `ui/`; follow its local rules. Keep pure helpers imported by tests free of browser calls at module load.
- Send and receive `ClientMsg` and `ServerMsg` (`src/shared/protocol.ts`) through `net.ts`, updating server handlers and client readers together.
- Verify interactive changes in an isolated browser against a built server on a spare port, never the owner's `:4700`.
