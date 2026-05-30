import { createRefreshAuthRouter } from "@insforge/sdk/ssr";

const { POST } = createRefreshAuthRouter({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_API_URL!,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
});

export { POST };
