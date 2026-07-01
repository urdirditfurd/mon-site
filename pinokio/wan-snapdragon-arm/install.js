module.exports = {
  run: [
    {
      method: "script.start",
      params: {
        uri: "torch.js",
        params: {
          venv: "env",
        },
      },
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: "pip install -r requirements.txt",
      },
    },
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
