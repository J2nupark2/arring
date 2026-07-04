// Pings a dynamic page every 5 minutes so the Next.js SSR function stays
// warm — otherwise low-traffic periods put it to sleep and the next click
// pays a 3-5s cold start.
export default async () => {
  const url = process.env.URL ?? "https://a2rring.netlify.app";
  await fetch(`${url}/login`, { headers: { "x-keepalive": "1" } }).catch(
    () => {},
  );
  return new Response("ok");
};

export const config = {
  schedule: "*/5 * * * *",
};
