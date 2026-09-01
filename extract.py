from pypdf import PdfReader

reader = PdfReader("../Prepare for Import - Apricot.pdf")
text = ""
for page in reader.pages:
    text += page.extract_text() + "\n"

with open("manuals/Apricot_Mapping.txt", "w") as f:
    f.write(text)
