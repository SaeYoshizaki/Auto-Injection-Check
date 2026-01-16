import base64
import codecs


class Buff:
    def transform(self, text):
        return text


class Base64Buff(Buff):
    def transform(self, text):
        encoded = base64.b64encode(text.encode("utf-8"))
        return encoded.decode("utf-8")


class Rot13Buff(Buff):
    def transform(self, text):
        return codecs.encode(text, "rot_13")
