import { MarkdownApp } from "./app/App";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

const app = new MarkdownApp(root);
app.mount();
