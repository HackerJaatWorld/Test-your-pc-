import type { Config, Scenario } from "artillery";

export const config: Config = {
  target: "http://localhost:3000",
  phases: [
    {
      duration: 30, // seconds
      arrivalRate: 1, // 1 virtual user per second
      name: "warm_up",
    },
  ],
};

export const scenarios: Scenario[] = [
  {
    name: "HTTP Endpoints Test",
    engine: "http",
    flow: [
      { get: { url: "/" } },
      { get: { url: "/services" } },
      { get: { url: "/pricing" } },
      { get: { url: "/areas" } },
      { get: { url: "/book" } },
    ],
  },
];
