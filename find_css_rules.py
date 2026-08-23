css_path = "/home/cyrus/Documents/verdura/clean_styles.css"

with open(css_path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's find the start of normal CSS rules after the font-face definitions.
# We can search for key brand variables like ':root' or 'stage' or 'ink' or 'gold'.
# Usually, variables start with :root or are defined in a root selector.
root_idx = content.find(":root")
if root_idx != -1:
    print(f"':root' found at character {root_idx}")
    print("CSS starting from :root:")
    print(content[root_idx:root_idx+2000])
else:
    # Let's search for some standard selectors or print the end of the CSS content
    print("Could not find ':root'. Printing the last 2000 characters of CSS:")
    print(content[-2000:])
