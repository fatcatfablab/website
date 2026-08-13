(() => {
  const app = document.querySelector("#workshop-app");
  if (!app) return;

  const API = app.dataset.apiOrigin;
  const state = {
    step: 1,
    participantId: sessionStorage.getItem("fcfl-maker-participant") || "",
    selected: new Set(),
    workshops: [],
  };

  const $ = (selector) => app.querySelector(selector);
  const $$ = (selector) => [...app.querySelectorAll(selector)];

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function showStep(nextStep) {
    state.step = nextStep;
    $$(".step").forEach((section) => {
      const active = Number(section.dataset.step) === nextStep;
      section.hidden = !active;
      section.classList.toggle("is-active", active);
    });
    $("#step-label").textContent = `Step ${nextStep} of 3`;
    $("#step-progress").style.width = `${(nextStep / 3) * 100}%`;
    const target = $(`.step[data-step="${nextStep}"] input, .step[data-step="${nextStep}"] button`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => target?.focus({ preventScroll: true }), 180);
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (!button.dataset.label) button.dataset.label = button.innerHTML;
    button.innerHTML = busy ? `<span class="button-spinner"></span>${label}` : button.dataset.label;
  }

  function initials(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function avatarHue(name) {
    let value = 0;
    for (const char of name) value = (value * 31 + char.charCodeAt(0)) % 360;
    return value;
  }

  function renderWorkshops() {
    const list = $("#workshop-list");
    if (!state.workshops.length) {
      list.innerHTML = `<div class="empty-list"><span aria-hidden="true">＋</span><h2>Start the list</h2><p>Your workshop idea will appear here.</p></div>`;
      return;
    }

    list.innerHTML = state.workshops.map((workshop, index) => {
      const checked = state.selected.has(workshop.id);
      const attendees = workshop.attendees || [];
      const visible = attendees.slice(0, 5);
      const overflow = attendees.length - visible.length;
      return `
        <label class="workshop-card${checked ? " is-selected" : ""}" style="--delay:${index * 45}ms">
          <input type="checkbox" value="${workshop.id}" ${checked ? "checked" : ""} />
          <span class="card-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5 10 3 3 7-7" /></svg></span>
          <span class="card-content">
            <strong>${escapeHtml(workshop.title)}</strong>
            <span class="attendee-row">
              <span class="avatar-stack" aria-hidden="true">
                ${visible.map((person) => `<span class="avatar" style="--avatar-hue:${avatarHue(person.firstName)}">${escapeHtml(initials(person.firstName))}</span>`).join("")}
                ${overflow > 0 ? `<span class="avatar avatar--more">+${overflow}</span>` : ""}
              </span>
              <span>${workshop.attendeeCount} ${workshop.attendeeCount === 1 ? "person" : "people"} interested</span>
            </span>
          </span>
        </label>`;
    }).join("");

    list.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) state.selected.add(input.value);
        else state.selected.delete(input.value);
        input.closest(".workshop-card").classList.toggle("is-selected", input.checked);
        updateSelectionCount();
      });
    });
    updateSelectionCount();
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  }

  function updateSelectionCount() {
    const count = state.selected.size;
    $("#selection-count").textContent = `${count} selected`;
  }

  async function loadWorkshops({ quiet = false } = {}) {
    const refresh = $("#refresh-button");
    $("#list-error").textContent = "";
    refresh.classList.toggle("is-spinning", !quiet);
    try {
      const suffix = state.participantId ? `?participantId=${encodeURIComponent(state.participantId)}` : "";
      const data = await request(`/api/workshops${suffix}`, { method: "GET", headers: {} });
      state.workshops = data.workshops;
      state.selected = new Set(data.workshops.filter((workshop) => workshop.isAttending).map((workshop) => workshop.id));
      renderWorkshops();
    } catch (error) {
      $("#list-error").textContent = error.message;
      if (!state.workshops.length) $("#workshop-list").innerHTML = "";
    } finally {
      refresh.classList.remove("is-spinning");
    }
  }

  $("#identity-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const firstName = $("#first-name").value.trim();
    const email = $("#email").value.trim();
    const error = $("#identity-error");
    error.textContent = "";
    if (!firstName) {
      error.textContent = "Enter your first name.";
      $("#first-name").focus();
      return;
    }
    if (email && !$("#email").checkValidity()) {
      error.textContent = "Enter a valid email address or leave it blank.";
      $("#email").focus();
      return;
    }
    setBusy(button, true, "Saving…");
    try {
      const data = await request("/api/participants", {
        method: "POST",
        body: JSON.stringify({ firstName, email }),
      });
      state.participantId = data.participant.id;
      sessionStorage.setItem("fcfl-maker-participant", state.participantId);
      showStep(2);
    } catch (apiError) {
      error.textContent = apiError.message;
    } finally {
      setBusy(button, false);
    }
  });

  $("#no-idea").addEventListener("change", (event) => {
    const input = $("#workshop-idea");
    input.disabled = event.target.checked;
    if (event.target.checked) input.value = "";
  });

  $("#idea-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const noIdea = $("#no-idea").checked;
    const title = $("#workshop-idea").value.trim();
    const error = $("#idea-error");
    error.textContent = "";
    if (!noIdea && title.length < 2) {
      error.textContent = "Enter a workshop idea or choose N/A.";
      $("#workshop-idea").focus();
      return;
    }
    setBusy(button, true, noIdea ? "Loading…" : "Adding…");
    try {
      if (!noIdea) {
        await request("/api/workshops", {
          method: "POST",
          body: JSON.stringify({ participantId: state.participantId, title }),
        });
      }
      showStep(3);
      await loadWorkshops();
    } catch (apiError) {
      error.textContent = apiError.message;
    } finally {
      setBusy(button, false);
    }
  });

  $$('[data-back]').forEach((button) => button.addEventListener("click", () => showStep(state.step - 1)));
  $("#refresh-button").addEventListener("click", () => loadWorkshops());

  $("#save-rsvps").addEventListener("click", async () => {
    const button = $("#save-rsvps");
    const error = $("#list-error");
    error.textContent = "";
    $("#success-message").hidden = true;
    setBusy(button, true, "Saving…");
    try {
      await request("/api/rsvps", {
        method: "POST",
        body: JSON.stringify({ participantId: state.participantId, workshopIds: [...state.selected] }),
      });
      await loadWorkshops({ quiet: true });
      $("#success-message").hidden = false;
      $("#success-message").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (apiError) {
      error.textContent = apiError.message;
    } finally {
      setBusy(button, false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.tagName !== "BUTTON" && state.step < 3) {
      const form = event.target.closest("form");
      if (form) form.requestSubmit();
    }
  });

  if (state.participantId) {
    showStep(3);
    loadWorkshops();
  }
})();
