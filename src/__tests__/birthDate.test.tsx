import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BirthDateField, { joinDate, pickerStart } from "../components/BirthDateField";

describe("BirthDateField", () => {
  it("joins the three boxes into one date, padded", () => {
    expect(joinDate({ year: "2000", month: "1", day: "5" })).toBe("2000-01-05");
    expect(joinDate({ year: "", month: "", day: "" })).toBe("");
    // Part-typed stays visible to the screen's check instead of vanishing.
    expect(joinDate({ year: "2000", month: "", day: "" })).toBe("2000--");
  });

  it("opens the calendar on the typed year", () => {
    expect(pickerStart({ year: "2000", month: "", day: "" })).toBe("2000-01-01");
    expect(pickerStart({ year: "1987", month: "7", day: "" })).toBe("1987-07-01");
    expect(pickerStart({ year: "20", month: "", day: "" })).toBe("");
  });

  it("shows a stored date and sends each change back", () => {
    const onChange = vi.fn();
    render(<BirthDateField value="2000-04-12" onChange={onChange} />);
    expect((screen.getByLabelText("Year of birth") as HTMLInputElement).value).toBe("2000");
    fireEvent.change(screen.getByLabelText("Year of birth"), { target: { value: "1999" } });
    expect(onChange).toHaveBeenLastCalledWith("1999-04-12");
    fireEvent.change(screen.getByLabelText("Day of birth"), { target: { value: "3x" } });
    expect(onChange).toHaveBeenLastCalledWith("1999-04-03");
  });
});
