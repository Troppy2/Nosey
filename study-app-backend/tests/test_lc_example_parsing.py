"""LeetCode statement example parsing, one test per HTML format LeetCode has shipped.

Zero parsed examples makes a problem unrunnable in the editor (Run and Submit are
disabled), so every format must keep parsing.
"""
from src.services.leetcode_service import LeetCodeService

PARAGRAPH_HTML = """<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<p><strong>Input:</strong> <code>nums = [2,7,11,15], target = 9</code></p>

<p><strong>Output:</strong> <code>[0,1]</code></p>

<p><strong>Explanation:</strong></p>

<p>The sum of <code>nums[0]</code> and <code>nums[1]</code> is <code>2 + 7 = 9</code>.</p>

<p><strong class="example">Example 2:</strong></p>

<p><strong>Input:</strong> <code>nums = [3,2,4], target = 6</code></p>

<p><strong>Output:</strong> <code>[1,2]</code></p>

<p><strong class="example">Example 3:</strong></p>

<p><strong>Input:</strong> <code>nums = [3,3], target = 6</code></p>

<p><strong>Output:</strong> <code>[0,1]</code></p>

<p>&nbsp;</p>
<p><strong>Constraints:</strong></p>

<ul>
\t<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
</ul>
"""

PRE_HTML = """<p><strong class="example">Example 1:</strong></p>
<pre>
<strong>Input:</strong> s = "abc"
<strong>Output:</strong> 3
<strong>Explanation:</strong> All three.
</pre>"""

DIV_HTML = """<p><strong class="example">Example 1:</strong></p>
<div class="example-block">
<p><strong>Input:</strong> <span class="example-io">n = 2</span></p>
<p><strong>Output:</strong> <span class="example-io">4</span></p>
</div>"""


def test_paragraph_format_parses_every_example() -> None:
    examples = LeetCodeService()._parse_examples(PARAGRAPH_HTML)
    assert [e.index for e in examples] == [1, 2, 3]
    assert examples[0].input_text == "nums = [2,7,11,15], target = 9"
    assert examples[0].output_text == "[0,1]"
    assert examples[0].explanation_text and examples[0].explanation_text.startswith("The sum of nums[0]")
    assert examples[1].explanation_text is None
    # The last example stops before the constraints section.
    assert examples[2].output_text == "[0,1]"
    assert "Constraints" not in examples[2].output_text


def test_pre_format_still_parses() -> None:
    examples = LeetCodeService()._parse_examples(PRE_HTML)
    assert len(examples) == 1
    assert examples[0].input_text == 's = "abc"'
    assert examples[0].output_text == "3"
    assert examples[0].explanation_text == "All three."


def test_example_block_format_still_parses() -> None:
    examples = LeetCodeService()._parse_examples(DIV_HTML)
    assert len(examples) == 1
    assert (examples[0].input_text, examples[0].output_text) == ("n = 2", "4")


def test_no_examples_returns_empty() -> None:
    assert LeetCodeService()._parse_examples("<p>No examples here.</p>") == []
