import { mountLab } from "../src/lab.js";
import { mountExperiment } from "../src/experiments/lab.js";
import { experiments } from "../src/experiments/catalog.js";
const id = new URLSearchParams(location.search).get("study") || "quilting",
  study = experiments.find((s) => s.id === id),
  name =
    study?.title || (id === "transfer" ? "Texture transfer" : "Image quilting");
document.querySelector("h1").textContent = name;
document.querySelector("[data-description]").textContent =
  study?.description ||
  (id === "transfer"
    ? "Reconstruct an image using patches of another material."
    : "Build a larger texture from a small sample, one minimum-error seam at a time.");
document.title = `${name} | Graphics Studies`;
const nav = document.querySelector("nav");
for (const s of experiments) {
  const a = document.createElement("a");
  a.href = `/?study=${s.id}`;
  a.textContent = s.title;
  nav.insertBefore(a, nav.lastElementChild);
}
if (study) {
  document.querySelector("footer").replaceChildren();
  const a = document.createElement("a");
  a.href = study.paper;
  a.textContent = `Original research · ${study.citation}`;
  document.querySelector("footer").append(a);
  mountExperiment(document.querySelector("#lab"), {
    id,
    assetsBase: "/web/assets",
  });
} else
  mountLab(document.querySelector("#lab"), {
    mode: id === "transfer" ? "transfer" : "quilting",
    assetsBase: "/web/assets",
  });
