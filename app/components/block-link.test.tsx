import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { BlockLink } from "./block-link";

function render(element: ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

describe("BlockLink", () => {
  it("renders a block-level anchor so parent spacing applies", () => {
    expect(render(<BlockLink to="/courses">Go</BlockLink>)).toBe(
      '<a class="block" href="/courses" data-discover="true">Go</a>'
    );
  });

  it("keeps extra classes alongside block", () => {
    expect(
      render(
        <BlockLink to="/team" className="mt-2">
          Team
        </BlockLink>
      )
    ).toContain('class="block mt-2"');
  });
});
