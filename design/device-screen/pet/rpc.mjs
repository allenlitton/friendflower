// Usage: node rpc.mjs <type> '<json payload>'  — talks to the local Harness daemon.
const [type, payloadJson = "{}"] = process.argv.slice(2);
const port = 18473;
const r = await fetch(`http://127.0.0.1:${port}/api/machines`, { headers: { "x-adapter-local": "1" } });
const j = await r.json();
const machines = j.data?.machines ?? j.machines;
const me = machines.find((m) => m.hostname?.startsWith("Allens-MacBook") || m.name?.startsWith("Allens-MacBook")) ?? machines[0];
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/local-ws`);
const requestId = crypto.randomUUID();
const t = setTimeout(() => { console.error("timeout"); process.exit(1); }, 15000);
ws.onopen = () => ws.send(JSON.stringify({ type: "machine_select", payload: { machineId: me.machineId, localProtocolVersion: 1, tool: true } }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "connected") ws.send(JSON.stringify({ type, payload: { ...JSON.parse(payloadJson), requestId } }));
  else if (m.type === `${type}_result` && m.payload?.requestId === requestId) {
    const s = JSON.stringify(m.payload);
    console.log(s.replace(/"data:image[^"]*"/g, "\"<img>\""));
    clearTimeout(t); ws.close(); process.exit(0);
  } else if (/error/i.test(m.type)) console.error(JSON.stringify(m).slice(0, 500));
};
