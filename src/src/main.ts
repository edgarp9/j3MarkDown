import { MarkdownApp } from "./app/App";
import {
  markStartupPoint,
  measureStartupBetween,
  measureStartupFromNavigationStart,
  measureStartupWork,
} from "./app/startup-profile";
import "./styles.css";

markStartupPoint("frontend JS start");
measureStartupFromNavigationStart(
  "WebView navigation start to frontend JS start",
  "frontend JS start",
);

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

markStartupPoint("app root found");
measureStartupBetween("frontend JS load to app root lookup", "frontend JS start", "app root found");

const app = measureStartupWork("MarkdownApp construction", () => new MarkdownApp(root));
measureStartupWork("MarkdownApp mount", () => app.mount());
markStartupPoint("MarkdownApp mount returned");
measureStartupBetween(
  "frontend JS start to MarkdownApp mount return",
  "frontend JS start",
  "MarkdownApp mount returned",
);
