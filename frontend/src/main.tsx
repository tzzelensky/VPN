import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
/* latin + cyrillic — иначе русский текст дроппера без пиксельного глифа */
import "@fontsource/press-start-2p/400.css";
import "./styles.css";
import { initAdminTheme } from "./adminTheme";

initAdminTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
