export default function Home() {
  return (
    <form
      action={async () => {
        "use server";
        refreshToken("1");
        refreshToken("1");
        refreshToken("1");
      }}
    >
      <button type="submit">Refresh</button>
    </form>
  );
}

async function refreshToken(refresh_token: string) {
  return (
    await fetch("http://localhost:3000/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token }),
    })
  ).json();
}
