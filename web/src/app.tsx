import { LocationProvider, Route, Router } from "preact-iso";
import { Compose } from "./routes/compose";
import { Import } from "./routes/import";
import { Inbox } from "./routes/inbox";
import { Message } from "./routes/message";
import { Unlock } from "./routes/unlock";

export function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Unlock} />
        <Route path="/import" component={Import} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/compose" component={Compose} />
        <Route path="/m/:id" component={Message} />
      </Router>
    </LocationProvider>
  );
}
