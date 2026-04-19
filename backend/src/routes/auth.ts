import { Router } from "express";

const router = Router();

router.post("/login", (req, res) => {
  const adminUser = process.env.ADMIN_USER ?? "tzadmin";
  const adminPass = process.env.ADMIN_PASSWORD ?? "8mayjkjk";
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === adminUser && password === adminPass) {
    req.session.user = { ok: true };
    res.json({ ok: true });
    return;
  }
  res.status(401).json({ error: "invalid_credentials" });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  res.json({ ok: Boolean(req.session.user?.ok) });
});

export default router;
