// Submits a TanStack form after checking every field again. A field's error from its last blur
// stays until it is checked again, so a value corrected but not yet blurred would otherwise
// still block the submit. Validation stays on blur and on submit; nothing checks on change.
export async function submitForm(form: {
  validateAllFields: (cause: "blur") => Promise<unknown>;
  handleSubmit: () => Promise<void>;
}): Promise<void> {
  await form.validateAllFields("blur");
  await form.handleSubmit();
}
