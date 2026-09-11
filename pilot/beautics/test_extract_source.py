import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('extract', pathlib.Path(__file__).with_name('extract-source.py'))
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class ExtractionTests(unittest.TestCase):
    def test_product_scoping_and_nested_label(self):
        parser = extract.Cards()
        parser.feed('''<span class="custom-label">global campaign</span>
        <div class="product-img"><span class="custom-label">10 <span>ב399</span> ש״ח</span>
        <a href="https://www.beautics-shop.co.il/product/one">one</a></div>
        <div class="product-img"><a href="https://www.beautics-shop.co.il/product/two">two</a></div>''')
        self.assertEqual(parser.cards[0]['badges'][0]['text'], '10 ב399 ש״ח')
        self.assertEqual(parser.cards[0]['badges'][0]['kind'], 'merchant-label')
        self.assertEqual(parser.cards[1]['badges'], [])

    def test_new_and_stock(self):
        parser = extract.Cards()
        parser.feed('''<div class="product-img"><span class="custom-label">חדש</span>
        <span class="sold-out-label">אזל<br/>מהמלאי</span>
        <a href="https://www.beautics-shop.co.il/product/one">one</a></div>''')
        self.assertEqual([b['kind'] for b in parser.cards[0]['badges']], ['new', 'stock'])
        self.assertEqual(parser.cards[0]['badges'][1]['text'], 'אזל מהמלאי')


if __name__ == '__main__':
    unittest.main()
