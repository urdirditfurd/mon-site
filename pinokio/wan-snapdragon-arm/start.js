module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        env: {
          SULPHUR_SNAPDRAGON: "1",
          SULPHUR_ALLOW_CPU: "1",
          WAN_MODEL_CACHE: "{{cwd}}/models",
          GRADIO_SERVER_PORT: "7860",
        },
        message: "python gradio_server.py",
        on: [
          {
            event: "/(http:\\/\\/\\S+)/",
            done: true,
          },
        ],
      },
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}",
      },
    },
  ],
};
