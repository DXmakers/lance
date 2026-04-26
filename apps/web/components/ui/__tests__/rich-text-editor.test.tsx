import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import {
  RichTextEditor,
  buildRichTextSchema,
  validateRichText,
} from "../rich-text-editor";

function ControlledHarness({
  initial = "",
  onChange = () => {},
  ...rest
}: { initial?: string; onChange?: (next: string) => void } & Partial<
  React.ComponentProps<typeof RichTextEditor>
>) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextEditor
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("RichTextEditor (#143)", () => {
  it("renders the toolbar with the four formatting actions", () => {
    render(<ControlledHarness />);
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
    expect(screen.getByLabelText("Unordered list")).toBeInTheDocument();
    expect(screen.getByLabelText("Insert link")).toBeInTheDocument();
  });

  it("forwards textarea changes via onChange", () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);
    const ta = screen.getByTestId("rich-text-editor-textarea");
    fireEvent.change(ta, { target: { value: "hello" } });
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("wraps the selection in ** when the bold button is clicked", () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial="lance rocks" onChange={onChange} />);
    const ta = screen.getByTestId("rich-text-editor-textarea") as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 5); // select "lance"
    fireEvent.click(screen.getByLabelText("Bold"));
    expect(onChange).toHaveBeenLastCalledWith("**lance** rocks");
  });

  it("wraps the selection in _ when italic is clicked", () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial="hi there" onChange={onChange} />);
    const ta = screen.getByTestId("rich-text-editor-textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(3, 8);
    fireEvent.click(screen.getByLabelText("Italic"));
    expect(onChange).toHaveBeenLastCalledWith("hi _there_");
  });

  it("inserts an unordered list across the selected lines", () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial={"alpha\nbeta"} onChange={onChange} />);
    const ta = screen.getByTestId("rich-text-editor-textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(0, ta.value.length);
    fireEvent.click(screen.getByLabelText("Unordered list"));
    expect(onChange).toHaveBeenLastCalledWith("- alpha\n- beta");
  });

  it("inserts a link template with placeholder URL", () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial="see this" onChange={onChange} />);
    const ta = screen.getByTestId("rich-text-editor-textarea") as HTMLTextAreaElement;
    ta.setSelectionRange(4, 8); // select "this"
    fireEvent.click(screen.getByLabelText("Insert link"));
    expect(onChange).toHaveBeenLastCalledWith("see [this](https://)");
  });

  it("renders the counter and turns red over the limit", () => {
    render(<ControlledHarness initial="abcd" maxLength={3} />);
    const counter = screen.getByTestId("rich-text-editor-counter");
    expect(counter).toHaveTextContent("-1");
    expect(counter.className).toContain("text-rose-400");
  });

  it("surfaces a validation error when below minLength", () => {
    render(<ControlledHarness initial="hi" minLength={5} />);
    const error = screen.getByTestId("rich-text-editor-error");
    expect(error).toHaveTextContent("at least 5 characters");
  });

  it("does not invoke onChange when disabled", () => {
    const onChange = vi.fn();
    render(<ControlledHarness initial="payload" disabled onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Bold"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("buildRichTextSchema enforces min/max", () => {
    const schema = buildRichTextSchema(2, 4);
    expect(schema.safeParse("a").success).toBe(false);
    expect(schema.safeParse("ab").success).toBe(true);
    expect(schema.safeParse("abcde").success).toBe(false);
  });

  it("validateRichText returns structured errors", () => {
    expect(validateRichText("", 1).errors[0]).toMatch(/at least 1/);
    expect(validateRichText("ok", 0, 5).ok).toBe(true);
  });
});
