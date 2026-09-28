import "../test-dom";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_OPTIONS } from "../../records/schema";
import { RecordForm } from "./RecordForm";

// Testing Library unmounts automatically only when test globals exist; bun:test has none.
afterEach(cleanup);

function renderForm(servedTlds = ["localhost"]) {
  const onSubmit = mock(async () => {});
  const view = render(
    <RecordForm record={null} servedTlds={servedTlds} onSubmit={onSubmit} onCancel={() => {}} />,
  );
  return { ...view, onSubmit, user: userEvent.setup() };
}

test("suggests a local domain from the source", async () => {
  const { getByLabelText, user } = renderForm();
  await user.type(getByLabelText("Source"), "https://api.example.com/v1");
  expect(getByLabelText("Local domain")).toHaveProperty("value", "api.localhost");
});

test("stops suggesting once the domain is edited", async () => {
  const { getByLabelText, user } = renderForm();
  await user.type(getByLabelText("Local domain"), "cars.localhost");
  await user.type(getByLabelText("Source"), "https://api.example.com");
  expect(getByLabelText("Local domain")).toHaveProperty("value", "cars.localhost");
});

test("shows why a domain is invalid and blocks submit", async () => {
  const { getByLabelText, getByText, getByRole, user } = renderForm();
  await user.type(getByLabelText("Source"), "https://api.example.com");
  await user.clear(getByLabelText("Local domain"));
  await user.type(getByLabelText("Local domain"), "api.car.test");

  expect(getByText(/TLD ".test" is not served by portless/)).toBeTruthy();
  expect(getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
});

test("submits the source, domain and default options", async () => {
  const { getByLabelText, getByRole, onSubmit, user } = renderForm();
  await user.type(getByLabelText("Source"), "https://api.example.com");
  await user.click(getByRole("button", { name: "Add" }));
  expect(onSubmit).toHaveBeenCalledWith({
    source: "https://api.example.com",
    domain: "api.localhost",
    enabled: true,
    options: DEFAULT_OPTIONS,
  });
});
