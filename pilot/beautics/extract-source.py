"""Extract product-scoped badge observations from a saved Beautics page."""
import json
import sys
from html.parser import HTMLParser


class Cards(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.card = None
        self.label = None
        self.cards = []
        self.span_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        if tag == 'div':
            self.depth += 1
            if 'product-img' in classes:
                self.card = {'depth': self.depth, 'url': None, 'badges': []}
        if not self.card:
            return
        if tag == 'a' and '/product/' in attrs.get('href', '') and not self.card['url']:
            self.card['url'] = attrs['href']
        known = {'custom-label': 'merchant-label', 'matat_sale_badge': 'sale', 'sold-out-label': 'stock'}
        if tag == 'span':
            self.span_depth += 1
            for cls, kind in known.items():
                if cls in classes:
                    self.label = {'selector': '.' + cls, 'kind': kind, 'text': '', 'depth': self.span_depth}
        if tag == 'br' and self.label:
            self.label['text'] += ' '

    def handle_data(self, text):
        if self.label:
            self.label['text'] += text

    def handle_endtag(self, tag):
        if tag == 'span' and self.card:
            if self.label and self.span_depth == self.label['depth']:
                self.label['text'] = ' '.join(self.label['text'].split())
                self.label.pop('depth')
                if self.label['kind'] == 'merchant-label' and self.label['text'] == 'חדש':
                    self.label['kind'] = 'new'
                self.card['badges'].append(self.label)
                self.label = None
            self.span_depth = max(0, self.span_depth - 1)
        if tag == 'div':
            if self.card and self.depth == self.card['depth']:
                if self.card['url']:
                    self.cards.append({k: v for k, v in self.card.items() if k != 'depth'})
                self.card = None
                self.label = None
            self.depth -= 1


if __name__ == '__main__':
    parser = Cards()
    with open(sys.argv[1]) as source:
        parser.feed(source.read())
    print(json.dumps(parser.cards, ensure_ascii=False, indent=2))
