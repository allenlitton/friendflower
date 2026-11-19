// Universal Links: tells iOS that friendflower.app/invite/... links belong to the
// Friend Flower app, so tapping one opens the app (when installed) instead of Safari.
// Apple fetches this from https://friendflower.app/.well-known/apple-app-site-association.

const APP_ID = "UC3QB2G4WS.app.friendflower.ios"; // <Team ID>.<bundle id>

export const dynamic = "force-static";

export function GET() {
  return Response.json({
    applinks: {
      details: [{ appIDs: [APP_ID], components: [{ "/": "/invite/*" }] }],
    },
  });
}
