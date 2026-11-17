"""Regression coverage for private Kojo reasoning staying private."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from src.services.kojo_service import _ReasoningSplitter
from src.utils.exceptions import LLMException


@pytest.mark.parametrize("size", [1, 2, 7, 10000])
@pytest.mark.parametrize("marker", ["<<<ANSWER>>>", "  <<<ANSWER>>>  ", "\t<<<ANSWER>>>\t\r"])
def test_only_own_line_answer_marker_counts(size, marker):
    text = ('Sure!\n<<<REASONING>>>\nI must write <<<ANSWER>>> later.\n'
            '<<<ANSWER>>> is also quoted here.\nPrivate plan.\n'
            + marker + '\nINTENT: concept\nSUBTYPE: none\nATTEMPT: none\nStudent answer.')
    sp = _ReasoningSplitter(expect_labels=True)
    events = []
    for i in range(0, len(text), size):
        events.extend(sp.feed(text[i:i + size]))
    events.extend(sp.flush())
    answer = ''.join(t for c, t in events if c == 'answer')
    reasoning = ''.join(t for c, t in events if c == 'reasoning')
    assert answer.strip() == 'Student answer.'
    assert 'Private plan.' in reasoning
    assert 'Sure!' not in reasoning
    assert sp.labels['intent'] == 'concept'


@pytest.mark.parametrize("length", [0, 6, 80])
def test_short_preamble_is_held_and_dropped(length):
    sp = _ReasoningSplitter()
    assert sp.feed('x' * length) == []
    assert sp.feed('<<<REAS') == []
    events = sp.feed('ONING>>>\nplan\n<<<ANSWER>>>\nHello') + sp.flush()
    assert ''.join(t for c, t in events if c == 'reasoning') == '\nplan\n'
    assert ''.join(t for c, t in events if c == 'answer') == '\nHello'


@pytest.mark.parametrize("text", ['x' * 81, 'x' * 81 + '<<<REASONING>>>\nplan\n<<<ANSWER>>>\nanswer'])
def test_long_preamble_is_malformed(text):
    sp = _ReasoningSplitter()
    with pytest.raises(LLMException, match='Kojo got tangled up, try again'):
        sp.feed(text)


@pytest.mark.parametrize("text", [
    '', 'Sure!', '<<<REASONING>>>\nTheir answer: 42.',
    '<<<REASONING>>>\nUse <<<ANSWER>>> before replying.',
    '<<<REASONING>>>\n<<<ANSWER>>> is a quote, not a boundary.',
])
def test_missing_answer_fails_without_answer_events(text):
    sp = _ReasoningSplitter()
    events = sp.feed(text)
    assert not any(c == 'answer' for c, _ in events)
    with pytest.raises(LLMException, match='Kojo got tangled up, try again'):
        sp.flush()


def test_marker_at_chunk_end_waits_for_own_line_validation():
    sp = _ReasoningSplitter()
    assert not any(c == 'answer' for c, _ in sp.feed('<<<REASONING>>>\n<<<ANSWER>>>'))
    assert not any(c == 'answer' for c, _ in sp.feed(' is inline.\nPrivate text'))
    events = sp.feed('\n<<<ANSWER>>>\nHello') + sp.flush()
    assert ''.join(t for c, t in events if c == 'answer') == '\nHello'


def test_marker_at_eof_is_own_line():
    sp = _ReasoningSplitter()
    sp.feed('<<<REASONING>>>\nplan\n<<<ANSWER>>>  ')
    assert sp.flush() == []
    assert sp.in_answer


@pytest.mark.parametrize('mode', ['folder', 'general', 'regenerate'])
@pytest.mark.parametrize('reply', ['x' * 81, '<<<REASONING>>>\nTheir answer: 42.\nNo final marker.', '<<<REASONING>>>\nplan\n<<<ANSWER>>>\nPrivate plan\n<<<REASONING>>>\nTheir answer: 42.'])
async def test_malformed_stream_emits_error_and_saves_no_assistant(mode, reply, db_session_maker, monkeypatch):
    from httpx import AsyncClient
    from sqlalchemy import select
    from src.database import get_session
    from src.dependencies import get_current_user
    from src.main import app
    from src.models.user import User
    from src.models.folder import Folder
    from src.models.kojo_conversation import KojoConversation
    from src.models.kojo_message import KojoMessage
    from src.routes import kojo as routes
    from src.services import kojo_service as ks

    async with db_session_maker() as session:
        user = User(email='kojo@example.test', google_id='kojo-regression', age=20, is_admin=False, is_beta=False)
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name='Notes', is_archived=False)
        session.add(folder)
        await session.flush()
        conv = KojoConversation(user_id=user.id, folder_id=folder.id if mode == 'folder' else None)
        session.add(conv)
        await session.flush()
        if mode == 'regenerate':
            session.add(KojoMessage(conversation_id=conv.id, role='user', content='solve x + 1 = 2'))
        await session.commit()
        uid, fid, cid = user.id, folder.id, conv.id

    async def override_session():
        async with db_session_maker() as session:
            yield session

    slot = SimpleNamespace(release=Mock())
    monkeypatch.setattr(routes, '_kojo_gate', AsyncMock(return_value=slot))
    monkeypatch.setattr(routes, 'screen_user_input', AsyncMock())
    monkeypatch.setattr(routes, 'bind_usage', Mock())
    monkeypatch.setattr(ks, '_load_user_memory', AsyncMock(return_value=''))
    monkeypatch.setattr(ks.kojo_context_cache, 'get_folder_context', AsyncMock(return_value=('', False)))
    calls = []

    async def stream(self, prompt, provider=None):
        calls.append(prompt)
        for i in range(0, len(reply), 5):
            yield reply[i:i + 5]

    monkeypatch.setattr(ks.LLMService, 'stream_kojo', stream)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uid, age=20, is_admin=False, is_beta=False)
    path = (f'/kojo/folders/{fid}/chat/stream' if mode == 'folder'
            else f'/kojo/conversations/{cid}/chat/stream' if mode == 'general'
            else f'/kojo/conversations/{cid}/regenerate/stream')
    try:
        async with AsyncClient(app=app, base_url='http://test') as client:
            response = await client.post(path, json={'message': 'solve x + 1 = 2', 'reasoning': True})
        assert response.status_code == 200, response.text
        events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith('data:')]
        assert events == [{'type': 'error', 'message': 'Kojo got tangled up, try again.'}]
        assert len(calls) == 1
        slot.release.assert_called_once()
        async with db_session_maker() as session:
            messages = list((await session.scalars(select(KojoMessage).where(KojoMessage.conversation_id == cid))).all())
            assert [m.role for m in messages] == ['user']
    finally:
        app.dependency_overrides.clear()


def test_adjacent_markers_are_not_an_own_line_answer():
    sp = _ReasoningSplitter()
    events = sp.feed('<<<REASONING>>><<<ANSWER>>>\nPrivate reasoning')
    assert not any(c == 'answer' for c, _ in events)
    with pytest.raises(LLMException, match='Kojo got tangled up, try again'):
        sp.flush()


@pytest.mark.parametrize('answer', [
    'Walk me through your steps.\n<<<REASONING>>>\nTheir answer: x = 1\n<<<ANSWER>>>\nTry again.',
    'I need to draft this.\nINTENT: own_problem',
    'I need to draft this.\n**SUBTYPE:** math',
    'Their answer: 50 km/h',
    'Parallel answer: 60 km/h',
    '<thinking>Private deliberation</thinking>',
    'Private deliberation</think>',
])
def test_answer_is_buffered_and_rejected_before_private_content_escapes(answer):
    sp = _ReasoningSplitter(expect_labels=True)
    text = '<<<REASONING>>>\nINTENT: concept\nplan\n<<<ANSWER>>>\n' + answer
    events = []
    for char in text:
        events.extend(sp.feed(char))
    assert not any(c == 'answer' for c, _ in events)
    with pytest.raises(LLMException, match='Kojo got tangled up, try again'):
        sp.flush()


def test_valid_answer_is_released_only_at_eof():
    sp = _ReasoningSplitter()
    events = sp.feed('<<<REASONING>>>\nplan\n<<<ANSWER>>>\nA useful explanation.')
    assert not any(c == 'answer' for c, _ in events)
    assert sp.flush() == [('answer', '\nA useful explanation.')]


@pytest.mark.parametrize('size', [1, 7, 10000])
@pytest.mark.parametrize('gap', ['', '\n', '\r\n  \n'])
def test_native_reply_with_labels_and_answer_but_no_start(size, gap):
    sp = _ReasoningSplitter(expect_labels=True)
    text = 'INTENT: own_problem\nSUBTYPE: math\nATTEMPT: none\n' + gap + '<<<ANSWER>>>\nTry a parallel bus example.'
    events = []
    for i in range(0, len(text), size):
        events += sp.feed(text[i:i+size])
    assert not any(c == 'answer' for c, _ in events)
    events += sp.flush()
    assert ''.join(t for c,t in events if c == 'answer').strip() == 'Try a parallel bus example.'
    assert sp.labels['intent'] == 'own_problem'


@pytest.mark.parametrize('middle', ['Their answer: 0.5\n', 'Private plan.\n', ''])
def test_missing_start_never_accepts_private_prose_or_invalid_labels(middle):
    sp = _ReasoningSplitter(expect_labels=True)
    text = 'INTENT: nonsense\nSUBTYPE: math\nATTEMPT: none\n' + middle + '<<<ANSWER>>>\nStudent reply'
    with pytest.raises(LLMException):
        sp.feed(text)
        sp.flush()


@pytest.mark.parametrize('middle', ['Their answer: 0.5\n', 'Private plan.\n'])
def test_valid_labels_without_start_do_not_authorize_a_private_preamble(middle):
    sp = _ReasoningSplitter(expect_labels=True)
    text = 'INTENT: own_problem\nSUBTYPE: math\nATTEMPT: none\n' + middle + '<<<ANSWER>>>\nStudent reply'
    with pytest.raises(LLMException):
        sp.feed(text)
        sp.flush()


async def test_rejected_stream_closes_provider_before_returning_error(monkeypatch):
    from src.services.kojo_service import _stream_answer
    from src.services.llm_service import LLMService
    closed = []

    async def leaf(prompt):
        try:
            yield 'x' * 81
            pytest.fail('Rejected provider must not resume')
        finally:
            closed.append(True)

    svc = LLMService()
    monkeypatch.setattr(svc, '_stream_text_kojo_nvidia', leaf)
    with pytest.raises(LLMException, match='Kojo got tangled up'):
        async for _ in _stream_answer(svc, 'P', 'nvidia', True, [], show_reasoning=False):
            pytest.fail('Malformed preamble must not be sent')
    assert closed == [True]
