module.exports = {
  title: "Wan Snapdragon ARM",
  description:
    "[Snapdragon / sans NVIDIA] Wan 2.1 text-to-video — CPU ARM local (0€) + pont Colab GPU gratuit. Pour Surface Copilot+ et PC sans CUDA.",
  icon: "icon.png",
  menu: [
    {
      icon: "fa-solid fa-power-off",
      text: "Install",
      href: "install.js",
      params: { fullscreen: true, running: false },
    },
    {
      icon: "fa-solid fa-rocket",
      text: "Run",
      href: "start.js",
      params: { fullscreen: true, running: true },
    },
    {
      icon: "fa-solid fa-cloud",
      text: "Colab GPU gratuit",
      href: "colab.js",
      params: { fullscreen: false, running: false },
    },
    {
      icon: "fa-solid fa-stethoscope",
      text: "Check",
      href: "check.js",
      params: { fullscreen: true, running: false },
    },
    {
      icon: "fa-solid fa-rotate",
      text: "Reset",
      href: "reset.js",
      params: { fullscreen: true, running: false },
    },
  ],
};
