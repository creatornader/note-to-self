import { render } from "preact";

function App() {
  return (
    <main>
      <h1>Note to Self</h1>
      <p>PWA scaffold. Routes land in chunk 6.</p>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
