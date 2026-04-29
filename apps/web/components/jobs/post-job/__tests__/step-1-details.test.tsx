import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Step1Details } from "../step-1-details";

describe("Step1Details", () => {
  const defaultProps = {
    title: "",
    setTitle: () => {},
    description: "",
    setDescription: () => {},
    tagsInput: "",
    setTagsInput: () => {},
    skillsInput: "",
    setSkillsInput: () => {},
  };

  it("renders all required fields", () => {
    render(<Step1Details {...defaultProps} />);

    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required skills/i)).toBeInTheDocument();
  });

  it("shows required asterisk on labels", () => {
    render(<Step1Details {...defaultProps} />);

    const titleLabel = screen.getByLabelText(/job title/i).previousSibling;
    expect(titleLabel).toHaveTextContent("*");
  });

  it("displays error messages when provided", () => {
    render(
      <Step1Details
        {...defaultProps}
        titleError="Title is too short"
        descriptionError="Description required"
      />
    );

    expect(screen.getByText("Title is too short")).toBeInTheDocument();
    expect(screen.getByText("Description required")).toBeInTheDocument();
  });

  it("calls setTitle when title input changes", () => {
    const setTitle = vi.fn();
    render(<Step1Details {...defaultProps} setTitle={setTitle} />);

    fireEvent.change(screen.getByLabelText(/job title/i), {
      target: { value: "New Title" },
    });

    expect(setTitle).toHaveBeenCalledWith("New Title");
  });

  it("disables inputs when disabled prop is true", () => {
    render(<Step1Details {...defaultProps} disabled={true} />);

    expect(screen.getByLabelText(/job title/i)).toBeDisabled();
    expect(screen.getByTestId("rich-text-editor")).toBeDisabled();
  });
});
