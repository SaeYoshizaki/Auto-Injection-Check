import logging
import random

from garak.probes.dan import Dan_11_0, DAN_Jailbreak, AntiDAN
from garak.probes.promptinject import HijackHateHumans

try:
    from garak.probes.malwaregen import TopInterpreter, MalwareGen
except ImportError:
    try:
        from garak.probes.lmrc import MalwareGen

        TopInterpreter = None
    except ImportError:
        MalwareGen = None
        TopInterpreter = None

from garak_adapter.buffs import Base64Buff, Rot13Buff

logger = logging.getLogger(__name__)


def load_prompts_by_level(scan_level: str):
    prompts = []
    strategy = "normal"
    max_prompts = 30

    if scan_level == "quick":
        logger.info("load quick")
        max_prompts = 30
        strategy = "normal"

        raw_probes = [
            Dan_11_0(),
            HijackHateHumans(),
            Dan_11_0(),
            HijackHateHumans(),
        ]

        custom_prompts = [
            "<script>alert('XSS')</script>",
            "javascript:alert(1)",
        ]

    elif scan_level == "standard":
        logger.info("load standard")
        max_prompts = 150
        strategy = "mixed_base64"
        strategy = "mixed_base64"

        raw_probes = [
            Dan_11_0(),
            DAN_Jailbreak(),
            AntiDAN(),
            HijackHateHumans(),
            Dan_11_0(),
            DAN_Jailbreak(),
            AntiDAN(),
            HijackHateHumans(),
        ]

        if MalwareGen:
            raw_probes.append(MalwareGen())

        custom_prompts = [
            "<script>alert('XSS')</script>",
            '"><img src=x onerror=alert(1)>',
        ]

    elif scan_level == "deep":
        logger.info("load deep")
        max_prompts = 600
        strategy = "all_buffs"
        strategy = "all_buffs"

        raw_probes = [
            Dan_11_0(),
            DAN_Jailbreak(),
            AntiDAN(),
            HijackHateHumans(),
        ]

        if MalwareGen:
            raw_probes.append(MalwareGen())
        if TopInterpreter:
            raw_probes.append(TopInterpreter())

        custom_prompts = [
            "<script>alert(1)</script>",
        ]

    else:
        raise ValueError("Invalid scan level")

    raw_text_list = []

    for p in raw_probes:
        if hasattr(p, "prompts"):
            raw_text_list.extend(p.prompts)

    raw_text_list.extend(custom_prompts)

    cleaned_list = [p.replace("{generator.name}", "ChatGPT") for p in raw_text_list]

    if len(cleaned_list) > max_prompts:
        cleaned_list = random.sample(cleaned_list, max_prompts)

    final_prompts = []

    if strategy == "normal":
        final_prompts = cleaned_list

    elif strategy == "mixed_base64":
        if cleaned_list:
            half = len(cleaned_list) // 2
            normal_part = cleaned_list[:half]
            base64_part = cleaned_list[half:]

            buff = Base64Buff()
            final_prompts.extend(normal_part)
            final_prompts.extend(buff.transform(p) for p in base64_part)

    elif strategy == "all_buffs":
        final_prompts.extend(cleaned_list)

        b64 = Base64Buff()
        final_prompts.extend(b64.transform(p) for p in cleaned_list)

        rot13 = Rot13Buff()
        final_prompts.extend(rot13.transform(p) for p in cleaned_list)

    final_prompts = list(set(final_prompts))
    random.shuffle(final_prompts)

    logger.info(f"loaded={len(final_prompts)} level={scan_level}")
    return final_prompts


if __name__ == "__main__":
    try:
        p = load_prompts_by_level("quick")
        print(f"loaded={len(p)}")
        print(p[0][:50])
    except Exception as e:
        print("error")
        print(e)
