function App(): React.JSX.Element {
  return (
    <main className="container">
      <h1>Kotik Researcher</h1>
      <p>Agentic AI system to assist in research tasks</p>
      <p className="versions">
        Electron {window.api.versions.electron} · Chromium {window.api.versions.chrome} · Node{' '}
        {window.api.versions.node}
      </p>
    </main>
  )
}

export default App
