module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "app/env",
        message: [
          "pip uninstall torch torchvision torchaudio -y",
          "pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu",
          "python -c \"import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available())\"",
        ],
      },
    },
    {
      method: "shell.run",
      params: {
        venv: "app/env",
        path: "app",
        message: "pip install -r requirements.txt",
      },
    },
    {
      method: "shell.run",
      params: {
        venv: "app/env",
        path: "app",
        message: "python wan_engine.py check",
      },
    },
  ],
};
