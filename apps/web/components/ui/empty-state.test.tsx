import { render, screen } from "@testing-library/react";
import { Box } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders title, description, and icon", () => {
    render(
      <EmptyState
        title="Nothing here yet"
        description="Add your first record to get started."
        icon={<Box data-testid="empty-icon" />}
      />,
    );

    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add your first record to get started."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
  });

  it("renders the action slot when provided", () => {
    render(
      <EmptyState
        title="No matches"
        description="Try broadening your search."
        action={<button type="button">Reset filters</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reset filters" }),
    ).toBeInTheDocument();
  });
});
