from metidos import add_agent_tool


def validate_props(props):
    name = props.get("name", "Metidos") if isinstance(props, dict) else "Metidos"
    if not isinstance(name, str) or len(name.strip()) == 0:
        name = "Metidos"
    return {"name": name.strip()}


async def action(context, props):
    return {
        "type": "markdown",
        "markdown": f"## Hello, {props['name']}!\n\nThis response came from the copyable Python Hello Tool example plugin.",
    }


add_agent_tool(
    {
        "tool": "python_hello_world",
        "name": "Python hello world",
        "description": "Return a greeting from a Python plugin.",
        "timeoutMs": 5000,
        "validateProps": validate_props,
        "action": action,
    }
)
