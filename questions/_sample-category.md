# Category: Sample Category
Icon: Icon_Lightning
Color: #7030A0

## E1
Q: This sample question shows how a prompt can wrap onto
a second line while still being treated as one block of text.
A) Correct
B) Incorrect
C) Also incorrect
D) Still incorrect
Answer: A
Fact: Facts are shown only to the GM during play.

## E2
Q: What symbol marks the start of a question heading in this format?
A) **
B) ##
C) --
D) //
Answer: B
Fact: Headings use two hash marks followed by a difficulty code like E1.

## E3
Q: Which label introduces the correct-answer line?
A) Correct:
B) Key:
C) Answer:
D) Solution:
Answer: C

## E4
Q: How many answer options must every question have?
A) Two
B) Three
C) Four
D) Five
Answer: C
Fact: Options are always labelled A) through D).

## M1
Q: Which difficulty letters are valid for a question heading?
A) L, M, H
B) E, M, H
C) E, N, H
D) E, M, D
Answer: B
Fact: This sample deliberately spans two lines to show that fun facts,
like questions, can wrap without breaking the format.

## M2
Q: What must the Fact line be, according to the format rules?
A) Required and single-line only
B) Required and multi-line
C) Optional
D) Forbidden
Answer: C

## M3
Q: What happens if a category file has a formatting error?
A) The bad question is skipped, the rest load normally
B) The whole file is rejected, but every error is still reported
C) The parser guesses the intended value
D) The file loads with a warning icon
Answer: B
Fact: Strict rejection keeps the question bank consistent across the app.

## M4
Q: Where does a category's icon file live?
A) css/icons
B) assets/icons
C) questions/icons
D) js/icons
Answer: B

## H1
Q: What string format is used to reference a specific question globally?
A) slug#id
B) slug/id
C) slug:id
D) id:slug
Answer: C
Fact: For example, a ref might look like "movie-night:E1".

## H2
Q: Starting from what number must each difficulty's ids count up?
A) 0
B) 1
C) 10
D) 100
Answer: B

## H3
Q: Which file lists every category the app should load?
A) questions/manifest.json
B) questions/categories.md
C) questions/index.json
D) questions/list.txt
Answer: C
Fact: Filenames starting with an underscore, like this sample, are skipped.

## H4
Q: Under strict parsing, what happens to duplicate or missing difficulty numbers?
A) They are silently renumbered
B) They are reported as errors
C) They are allowed if rare
D) They are merged together
Answer: B
