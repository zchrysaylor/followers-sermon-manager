import type { Sermon } from "../shared/types";

(function () {
  let isAuthenticated = false;
  let currentPage = 1;
  const limit = 10;
  const sermonsById = new Map<string, Sermon>();
  let editDialog: HTMLDialogElement;
  let editForm: HTMLFormElement;
  let editFields: HTMLFieldSetElement;
  let editAudio: HTMLInputElement;
  let editDuration: HTMLInputElement;
  let editMessage: HTMLElement;
  let durationInfo: HTMLElement;
  let currentAudio: HTMLAudioElement;
  let editingSermon: Sermon | null = null;
  let saving = false;
  let calculatingDuration = false;
  let audioSelection = 0;
  let replacement: { file: File; audioUrl: string } | null = null;

  async function init() {
    // Check authentication on page load
    const isAuthed = await checkAuth();
    if (!isAuthed) {
      // Redirect to login page if not authenticated
      window.location.href = "/index.html";
      return;
    }

    isAuthenticated = true;

    editDialog = document.getElementById("edit-dialog") as HTMLDialogElement;
    editForm = document.getElementById("edit-form") as HTMLFormElement;
    editFields = document.getElementById("edit-fields") as HTMLFieldSetElement;
    editAudio = document.getElementById("edit-audio") as HTMLInputElement;
    editDuration = document.getElementById("edit-duration") as HTMLInputElement;
    editMessage = document.getElementById("edit-message") as HTMLElement;
    durationInfo = document.getElementById("edit-duration-info") as HTMLElement;
    currentAudio = document.getElementById(
      "edit-current-audio",
    ) as HTMLAudioElement;
    editForm.addEventListener("submit", saveSermon);
    editAudio.addEventListener("change", calculateDuration);
    document
      .getElementById("edit-cancel")!
      .addEventListener("click", () => editDialog.close());
    editDialog.addEventListener("cancel", (e: Event) => {
      if (saving) e.preventDefault();
    });
    editDialog.addEventListener("close", () => {
      currentAudio.pause();
      audioSelection++;
      editingSermon = null;
    });
    document
      .getElementById("sermons-container")!
      .addEventListener("click", (e: Event) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>(
          ".edit, .delete, .read-more",
        );
        if (!target) return;
        if (target.classList.contains("edit")) openEditor(target.dataset.id!);
        else if (target.classList.contains("delete"))
          handleDelete(target as HTMLButtonElement);
        else toggleDescription(target);
      });

    // Add logout button handler
    const logoutBtn = document.getElementById(
      "logout-btn",
    ) as HTMLButtonElement;
    if (logoutBtn) {
      logoutBtn.addEventListener("click", logout);
    }

    // Initial load
    loadSermons();

    // Load more button handler
    const loadMoreBtn = document.getElementById(
      "load-more",
    ) as HTMLButtonElement;
    loadMoreBtn.addEventListener("click", async () => {
      loadMoreBtn.disabled = true;
      await loadSermons(currentPage + 1, true);
      loadMoreBtn.disabled = false;
    });
  }

  async function checkAuth(): Promise<boolean> {
    try {
      const res = await fetch("/api/session");
      const json = await res.json();
      return Boolean(json?.ok);
    } catch {
      return false;
    }
  }

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // ignore
    }
    window.location.href = "/index.html";
  }

  async function loadSermons(page: number = 1, append: boolean = false) {
    const sermonsContainer = document.getElementById(
      "sermons-container",
    ) as HTMLElement;
    const pagination = document.getElementById("pagination") as HTMLElement;

    try {
      const response = await fetch(
        `/api/sermons?page=${page}&limit=${limit}&refresh=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Failed to load sermons");
      const data = await response.json();
      currentPage = page;
      if (!append) sermonsById.clear();
      data.sermons.forEach((sermon: Sermon) =>
        sermonsById.set(sermon.id, sermon),
      );

      if (data.sermons.length === 0 && page === 1) {
        sermonsContainer.innerHTML =
          "<p class='loading'>No sermons available.</p>";
        pagination.classList.add("hidden");
        return;
      }

      if (data.sermons.length < limit) {
        pagination.classList.add("hidden");
      } else {
        pagination.classList.remove("hidden");
      }

      const sermonsHtml = data.sermons
        .map((sermon: Sermon) => createSermonCard(sermon))
        .join("");

      if (append) {
        sermonsContainer.insertAdjacentHTML("beforeend", sermonsHtml);
      } else {
        sermonsContainer.innerHTML = sermonsHtml;
      }
    } catch (error) {
      if (append) {
        showListMessage(
          "Error loading more sermons. Please try again.",
          "error",
        );
      } else {
        sermonsContainer.innerHTML =
          "<p class='loading'>Error loading sermons.</p>";
      }
    }
  }

  function createSermonCard(sermon: Sermon): string {
    const date = new Date(sermon.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const duration = formatDuration(sermon.durationSeconds);
    const descriptionId = `desc-${sermon.id}`;
    const needsTruncation = sermon.description.length > 150;
    const tagsHtml =
      sermon.keywords && sermon.keywords.length > 0
        ? `<div class="sermon-tags">${sermon.keywords.map((tag: string) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
        : "";

    return `
    <div class="sermon-card" data-id="${escapeHtml(sermon.id)}">
      <h3>${escapeHtml(sermon.title)}</h3>
      <div class="sermon-meta">
        ${escapeHtml(sermon.speaker)} • ${date} • ${duration}
      </div>
      ${tagsHtml}
      <p class="sermon-description ${needsTruncation ? "collapsed" : ""}" id="${escapeHtml(descriptionId)}">
        ${escapeHtml(sermon.description)}
      </p>
      ${needsTruncation ? `<span class="read-more" data-target="${escapeHtml(descriptionId)}">Read more</span>` : ""}
      <audio controls src="${escapeHtml(sermon.audioUrl)}"></audio>
      ${
        isAuthenticated
          ? `
        <div class="sermon-actions">
          <button class="edit" data-id="${escapeHtml(sermon.id)}">Edit</button>
          <button class="delete" data-id="${escapeHtml(sermon.id)}">Delete</button>
        </div>
      `
          : ""
      }
    </div>
  `;
  }

  function openEditor(id: string): void {
    const sermon = sermonsById.get(id);
    if (!sermon) return;
    editingSermon = sermon;
    editForm.reset();
    editAudio.setCustomValidity("");
    replacement = null;
    calculatingDuration = false;
    audioSelection++;
    editMessage.classList.add("hidden");
    durationInfo.classList.add("hidden");
    for (const name of ["title", "speaker", "description"] as const) {
      (
        editForm.elements.namedItem(name) as
          | HTMLInputElement
          | HTMLTextAreaElement
      ).value = sermon[name];
    }
    (editForm.elements.namedItem("date") as HTMLInputElement).value =
      sermon.date.slice(0, 10);
    (editForm.elements.namedItem("keywords") as HTMLInputElement).value = (
      sermon.keywords || []
    ).join(", ");
    editDuration.value = String(sermon.durationSeconds);
    currentAudio.src = sermon.audioUrl;
    const audioLink = document.getElementById(
      "edit-audio-link",
    ) as HTMLAnchorElement;
    audioLink.href = sermon.audioUrl;
    audioLink.textContent =
      sermon.audioUrl.split("/").pop() || "Open current audio";
    editDialog.showModal();
  }

  function showEditMessage(message: string, type: "info" | "error"): void {
    editMessage.textContent = message;
    editMessage.className = `message ${type}`;
  }

  function showListMessage(message: string, type: "success" | "error"): void {
    const element = document.getElementById("sermons-message") as HTMLElement;
    element.textContent = message;
    element.className = `message ${type}`;
  }

  async function calculateDuration(): Promise<void> {
    const selection = ++audioSelection;
    const file = editAudio.files?.[0];
    replacement = null;
    calculatingDuration = false;
    editAudio.setCustomValidity("");
    durationInfo.classList.add("hidden");
    editMessage.classList.add("hidden");
    if (!file) {
      editDuration.value = String(editingSermon?.durationSeconds || "");
      return;
    }
    if (
      !file.name.toLowerCase().endsWith(".mp3") ||
      file.size === 0 ||
      file.size > 200 * 1024 * 1024
    ) {
      editAudio.setCustomValidity(
        "Choose a non-empty MP3 file no larger than 200MB.",
      );
      editAudio.reportValidity();
      return;
    }
    calculatingDuration = true;
    durationInfo.textContent = "Calculating duration...";
    durationInfo.className = "info";
    let audioContext: AudioContext | undefined;
    try {
      audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(
        await file.arrayBuffer(),
      );
      if (selection !== audioSelection) return;
      const duration = Math.round(decoded.duration);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error("Invalid duration");
      editDuration.value = String(duration);
      durationInfo.textContent = `Replacement duration: ${formatDuration(duration)}`;
    } catch (error: any) {
      if (selection !== audioSelection) return;
      editAudio.setCustomValidity(
        "Could not read this audio. Please choose another MP3 file.",
      );
      durationInfo.textContent =
        "Could not read this audio. Please choose another MP3 file.";
      durationInfo.className = "error";
    } finally {
      if (selection === audioSelection) calculatingDuration = false;
      await audioContext?.close();
    }
  }

  async function readResponse(response: Response): Promise<any> {
    if (response.status === 401) {
      throw new Error(
        "Your session has expired. Log in again on the Upload Sermon page, then retry saving.",
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Could not save the sermon. Please try again.",
      );
    return data;
  }

  async function saveSermon(e: Event): Promise<void> {
    e.preventDefault();
    if (!editingSermon || saving) return;
    if (calculatingDuration) {
      showEditMessage(
        "Please wait for the audio duration to be calculated.",
        "info",
      );
      return;
    }
    if (!editForm.reportValidity()) return;
    const sermon = editingSermon;
    const formData = new FormData(editForm);
    const date = String(formData.get("date"));
    const changes = {
      id: sermon.id,
      title: String(formData.get("title")).trim(),
      speaker: String(formData.get("speaker")).trim(),
      // Retain the publication time on legacy records unless the date changes.
      date: date === sermon.date.slice(0, 10) ? sermon.date : date,
      description: String(formData.get("description")).trim(),
      keywords: String(formData.get("keywords") || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      durationSeconds: Number(formData.get("durationSeconds")),
    };
    const file = editAudio.files?.[0];
    saving = true;
    editFields.disabled = true;
    editForm.setAttribute("aria-busy", "true");
    showEditMessage("Saving changes...", "info");
    try {
      if (file && replacement?.file !== file) {
        const upload = await readResponse(
          await fetch("/api/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...changes,
              date,
              contentType: "audio/mpeg",
              fileSize: file.size,
            }),
          }),
        );
        showEditMessage("Uploading replacement audio...", "info");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener("progress", (event: ProgressEvent) => {
            if (event.lengthComputable)
              showEditMessage(
                `Uploading replacement audio... ${Math.round((event.loaded / event.total) * 100)}%`,
                "info",
              );
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error("Audio upload failed. Please try again."));
          });
          xhr.addEventListener("error", () =>
            reject(new Error("Audio upload failed. Please try again.")),
          );
          xhr.addEventListener("timeout", () =>
            reject(new Error("Audio upload timed out. Please try again.")),
          );
          xhr.open("PUT", upload.uploadUrl);
          xhr.timeout = 30 * 60 * 1000;
          xhr.setRequestHeader("Content-Type", "audio/mpeg");
          xhr.send(file);
        });
        replacement = { file, audioUrl: upload.audioUrl };
      }
      showEditMessage("Saving changes...", "info");
      const updated: Sermon = await readResponse(
        await fetch("/api/update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...changes,
            ...(file && replacement
              ? { audioUrl: replacement.audioUrl, audioFileSize: file.size }
              : {}),
          }),
        }),
      );
      sermonsById.set(updated.id, updated);
      const card = Array.from(
        document.querySelectorAll<HTMLElement>(".sermon-card"),
      ).find((element) => element.dataset.id === updated.id);
      if (card) card.outerHTML = createSermonCard(updated);
      editDialog.close();
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".sermon-actions .edit"),
      )
        .find((button) => button.dataset.id === updated.id)
        ?.focus();
      showListMessage("Sermon updated successfully!", "success");
    } catch (error: any) {
      console.error("Update sermon error:", error);
      showEditMessage(
        error.message || "Could not save the sermon. Please try again.",
        "error",
      );
    } finally {
      saving = false;
      editFields.disabled = false;
      editForm.removeAttribute("aria-busy");
    }
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toggleDescription(btn: HTMLElement) {
    const targetId = btn.dataset.target;
    const desc = document.getElementById(targetId!) as HTMLElement;

    if (desc.classList.contains("collapsed")) {
      desc.classList.remove("collapsed");
      desc.classList.add("expanded");
      btn.textContent = "Read less";
    } else {
      desc.classList.remove("expanded");
      desc.classList.add("collapsed");
      btn.textContent = "Read more";
    }
  }

  async function handleDelete(btn: HTMLButtonElement) {
    const id = btn.dataset.id;

    if (!id || !confirm("Are you sure you want to delete this sermon?")) {
      return;
    }

    try {
      const response = await fetch("/api/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        // Reload the page to refresh the list
        loadSermons();
      } else if (response.status === 401) {
        alert("Authentication failed. Redirecting to login...");
        window.location.href = "/index.html";
      } else {
        alert("Failed to delete sermon");
      }
    } catch (error) {
      alert("Error deleting sermon");
    }
  }

  // Initialize
  init();
})();
