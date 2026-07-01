module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: "python wan_engine.py check",
      },
    },
  ],
};
