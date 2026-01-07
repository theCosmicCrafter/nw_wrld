import "../rendererPolyfills.js";
import "../shared/styles/_main.scss";
import Projector from "./Projector.js";

if (document.querySelector(".projector")) {
  Projector.init();
}
