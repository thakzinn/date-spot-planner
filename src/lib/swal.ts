import Swal from "sweetalert2";

export { Swal };

// Full-screen blocking spinner shown while an async action runs.
// Call closeLoading() (or fire another Swal) when the work finishes.
export function showLoading(title = "Processing…") {
  Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading(),
  });
}

export function closeLoading() {
  Swal.close();
}

// Brief, non-blocking confirmation in the corner.
const toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2000,
  timerProgressBar: true,
});

export function showSuccess(title: string) {
  // Fires a fresh Swal, which dismisses any open loading modal.
  return toast.fire({ icon: "success", title });
}

export function showError(title: string) {
  return Swal.fire({ icon: "error", title });
}
