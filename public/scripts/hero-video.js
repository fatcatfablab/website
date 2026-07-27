(() => {
  const minimumPosterMs = 2_500;

  const initialize = (poster) => {
    if (!(poster instanceof HTMLImageElement) || poster.dataset.heroPosterReady === "true") return;

    const banner = poster.closest(".banner-thumbnail-wrapper");
    const video = banner?.querySelector("[data-hero-video]");
    if (!(video instanceof HTMLVideoElement)) return;

    poster.dataset.heroPosterReady = "true";
    const startedAt = performance.now();
    let revealScheduled = false;

    const scheduleReveal = () => {
      if (revealScheduled) return;
      revealScheduled = true;
      const remaining = Math.max(0, minimumPosterMs - (performance.now() - startedAt));
      window.setTimeout(() => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          revealScheduled = false;
          video.addEventListener("canplay", scheduleReveal, { once: true });
          return;
        }
        poster.classList.add("is-hidden");
      }, remaining);
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      scheduleReveal();
    } else {
      video.addEventListener("loadeddata", scheduleReveal, { once: true });
    }
  };

  document.querySelectorAll("[data-hero-video-poster]").forEach(initialize);
})();
